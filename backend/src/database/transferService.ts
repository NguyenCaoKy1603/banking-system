import { randomUUID } from "node:crypto";

import { UnitOfWork } from "./unitOfWork.js";
import { IdempotencyConflictError, RelationalConflictError, RelationalNotFoundError } from "./commandErrors.js";
import { AccountRepository } from "./repositories/accountRepository.js";
import { AnomalyRepository } from "./repositories/anomalyRepository.js";
import { AuditRepository } from "./repositories/auditRepository.js";
import { LedgerRepository } from "./repositories/ledgerRepository.js";
import { OutboxRepository } from "./repositories/outboxRepository.js";
import { TransferRepository, type TransferRow } from "./repositories/transferRepository.js";
import { evaluateTransferAnomaly } from "../domain/anomaly/index.js";
import { fingerprint, hashOpaqueToken } from "../security.js";
import { parseMoney, toMoney } from "../domain/money.js";
import type { Beneficiary, TransferAnomalyAssessment, TransferQuote, TransferReceipt } from "../types.js";
import { conflict, invalidRequest, notFound } from "../errors.js";
import { ControlPolicyRepository } from "./controlPolicyRepository.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuid(value: string, field: string): void {
  if (!UUID_PATTERN.test(value)) throw invalidRequest(`${field} is invalid.`, { [field]: `${field} must be a UUID.` });
}

export type TransferFaultPoint =
  | "after_idempotency_reserved"
  | "after_quote_consumed"
  | "after_transfer_inserted"
  | "after_balance_updated"
  | "after_ledger_written"
  | "after_audit_written"
  | "after_outbox_written";

export type TransferCommandInput = {
  customerId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  quoteId: string;
  transferId?: string;
  reference?: string;
  now?: string;
  description?: string;
  counterpartyName?: string | null;
  traceId?: string;
  fault?: (point: TransferFaultPoint) => void | Promise<void>;
};

export type TransferQuoteCommandInput = {
  customerId: string;
  sourceAccountId: string;
  beneficiaryId?: string;
  lookupId?: string;
  amount: unknown;
  now?: string;
};

function publicBeneficiary(row: Record<string, unknown>): Beneficiary {
  return {
    id: String(row.id),
    displayName: String(row.display_name),
    accountHolderName: row.account_holder_name
      ? String(row.account_holder_name)
      : row.destination_full_name
        ? String(row.destination_full_name)
        : undefined,
    maskedAccountNumber: String(row.masked_account_number),
    bankName: String(row.bank_name),
    status: String(row.status) as Beneficiary["status"],
  };
}

type TransferRowWithAssessment = TransferRow & {
  anomalyAssessment?: TransferAnomalyAssessment;
};

function publicTransfer(row: TransferRowWithAssessment): TransferReceipt {
  return {
    transferId: row.id,
    reference: row.reference,
    status: row.status,
    amount: toMoney(BigInt(row.amountMinor)),
    fee: toMoney(BigInt(row.feeMinor)),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.anomalyAssessment ? { anomalyAssessment: row.anomalyAssessment } : {}),
  };
}

/**
 * Direct-table transfer use case.  Controllers can keep their existing HTTP
 * contract and pass the authenticated customer/validated quote context here.
 * Every repository in the command receives the UnitOfWork's single client.
 */
export class RelationalTransferService {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  async createQuote(input: TransferQuoteCommandInput): Promise<TransferQuote> {
    assertUuid(input.sourceAccountId, "sourceAccountId");
    const hasBeneficiary = typeof input.beneficiaryId === "string" && input.beneficiaryId.trim().length > 0;
    const hasLookup = typeof input.lookupId === "string" && input.lookupId.trim().length > 0;
    if (hasBeneficiary === hasLookup) throw invalidRequest("Exactly one recipient reference is required.");
    if (hasBeneficiary) assertUuid(input.beneficiaryId!, "beneficiaryId");
    const amountMinor = parseMoney(input.amount, "amount");
    if (amountMinor <= 0n) throw conflict("Transfer amount is outside the sandbox limit.");
    const now = input.now ?? new Date().toISOString();
    const feeMinor = 1_000n;
    return this.unitOfWork.transaction(async ({ client }) => {
      await new ControlPolicyRepository(client).assertTransferAllowed(input.customerId, amountMinor);
      const accounts = new AccountRepository(client);
      const transfers = new TransferRepository(client);
      const source = await accounts.findOwnedAccount(input.customerId, input.sourceAccountId);
      if (!source) throw notFound("Account not found.");
      if (source.status !== "ACTIVE") throw conflict("The source account is not active.");
      const destination = hasBeneficiary
        ? await transfers.findActiveDestinationAccount(input.beneficiaryId!, input.customerId)
        : await transfers.findRecipientLookup(input.customerId, hashOpaqueToken(input.lookupId!));
      if (!destination) throw notFound("Beneficiary not found.");
      if (String(destination.status) !== "ACTIVE") throw conflict("Beneficiary is not active.");
      if (hasBeneficiary && String(destination.destination_status) !== "ACTIVE") throw conflict("The recipient account is not active.");
      const destinationAccountId = String(destination.destination_account_id ?? destination.destination_account_id);
      if (destinationAccountId === source.id) throw conflict("A transfer cannot be sent to the source account.");
      const beneficiary: Beneficiary = hasBeneficiary
        ? publicBeneficiary(destination)
        : {
          id: input.lookupId!,
          displayName: String(destination.account_holder_name),
          accountHolderName: String(destination.account_holder_name),
          maskedAccountNumber: String(destination.masked_account_number),
          bankName: String(destination.bank_name),
          status: String(destination.status) as Beneficiary["status"],
        };
      const quoteId = randomUUID();
      const expiresAt = new Date(Date.parse(now) + 5 * 60 * 1000).toISOString();
      await transfers.createQuote({
        id: quoteId,
        customerId: input.customerId,
        sourceAccountId: source.id,
        beneficiaryId: hasBeneficiary ? input.beneficiaryId : null,
        amountMinor: amountMinor.toString(),
        feeMinor: feeMinor.toString(),
        expiresAt,
        requestFingerprint: fingerprint({ quoteId, amountMinor: amountMinor.toString() }),
        beneficiarySnapshot: beneficiary,
        destinationAccountId,
        destinationOwnerId: String(destination.destination_owner_id ?? destination.destination_customer_id),
        destinationOwnerName: String(destination.destination_full_name ?? destination.account_holder_name ?? ""),
      });
      const signals = await new AnomalyRepository(client).getTransferRiskSignals({
        customerId: input.customerId,
        destinationAccountId,
        now,
      });
      const anomalyAssessment = evaluateTransferAnomaly({
        amountMinor,
        feeMinor,
        availableBalanceMinor: BigInt(source.availableMinor),
        isNewRecipient: !hasBeneficiary && !signals.hasPriorRelationship,
        recentTransfersLast10mCount: signals.recentTransfersLast10mCount,
        sameRecipientLast15mCount: signals.sameRecipientLast15mCount,
        occurredAt: now,
      });
      await new AuditRepository(client).append({
        id: randomUUID(),
        eventType: "TRANSFER_QUOTED",
        actorCustomerId: input.customerId,
        resourceId: quoteId,
        occurredAt: now,
      });
      return {
        quoteId,
        sourceAccountId: source.id,
        beneficiary,
        amount: toMoney(amountMinor),
        fee: toMoney(feeMinor),
        totalDebit: toMoney(amountMinor + feeMinor),
        expiresAt,
        anomalyAssessment,
      };
    }, { maxRetries: 1 });
  }

  async submit(input: TransferCommandInput): Promise<TransferRowWithAssessment> {
    assertUuid(input.quoteId, "quoteId");
    const now = input.now ?? new Date().toISOString();
    return this.unitOfWork.transaction(
      async ({ client }) => {
        const accounts = new AccountRepository(client);
        const anomalies = new AnomalyRepository(client);
        const transfers = new TransferRepository(client);
        const ledger = new LedgerRepository(client);
        const audit = new AuditRepository(client);
        const outbox = new OutboxRepository(client);

        const reservation = await transfers.reserveCommandIdempotency({
          id: randomUUID(),
          customerId: input.customerId,
          operationType: "TRANSFER_SUBMIT",
          idempotencyKey: input.idempotencyKey,
          requestFingerprint: input.requestFingerprint,
        });
        if (!reservation.created) {
          if (reservation.record.requestFingerprint !== input.requestFingerprint) {
            throw new IdempotencyConflictError();
          }
          if (reservation.record.aggregateId) {
            const canonical = await transfers.findById(reservation.record.aggregateId);
            if (canonical) return canonical;
          }
          throw new RelationalConflictError(
            "IDEMPOTENCY_IN_PROGRESS",
            "The transfer command is still being finalized; retry with the same key.",
          );
        }
        await input.fault?.("after_idempotency_reserved");

        const quote = await transfers.findQuoteForUpdate(input.quoteId);
        if (!quote || quote.customerId !== input.customerId) {
          throw new RelationalNotFoundError("Transfer quote not found.");
        }
        if (quote.consumedTransferId) {
          const canonical = await transfers.findById(quote.consumedTransferId);
          if (!canonical) {
            throw new RelationalConflictError(
              "IDEMPOTENCY_STATE_MISSING",
              "The consumed quote has no canonical transfer.",
            );
          }
          await transfers.completeCommandIdempotency(input.customerId, "TRANSFER_SUBMIT", input.idempotencyKey, {
            aggregateId: canonical.id,
            status: canonical.status,
            responsePayload: canonical,
          });
          return canonical;
        }
        if (Date.parse(quote.expiresAt) <= Date.parse(now)) {
          throw new RelationalConflictError("QUOTE_EXPIRED", "Transfer quote has expired.");
        }
        if (!quote.destinationAccountId || !quote.destinationOwnerId) {
          throw new RelationalConflictError(
            "RECIPIENT_NOT_FOUND",
            "The transfer quote has no internal destination account.",
          );
        }
        if (quote.sourceAccountId === quote.destinationAccountId) {
          throw new RelationalConflictError("SELF_TRANSFER", "A transfer cannot be sent to the source account.");
        }

        // A quote is only a preview. Re-read the durable policy after locking
        // the quote so a policy change between quote and submit takes effect
        // before any account lock or financial mutation.
        await new ControlPolicyRepository(client).assertTransferAllowed(
          input.customerId,
          BigInt(quote.amountMinor),
        );

        const lockedAccounts = await accounts.lockManyByIds([
          quote.sourceAccountId,
          quote.destinationAccountId,
        ]);
        if (lockedAccounts.length !== 2) {
          throw new RelationalNotFoundError("Transfer account not found.");
        }
        const source = lockedAccounts.find((account) => account.id === quote.sourceAccountId);
        const destination = lockedAccounts.find((account) => account.id === quote.destinationAccountId);
        if (!source || !destination || destination.customerId !== quote.destinationOwnerId) {
          throw new RelationalNotFoundError("Transfer account not found.");
        }
        if (source.customerId !== input.customerId) {
          throw new RelationalNotFoundError("Transfer account not found.");
        }
        if (source.status !== "ACTIVE" || destination.status !== "ACTIVE") {
          throw new RelationalConflictError("ACCOUNT_NOT_ACTIVE", "Both accounts must be active.");
        }

        const amount = BigInt(quote.amountMinor);
        const fee = BigInt(quote.feeMinor);
        const totalDebit = amount + fee;
        if (amount <= 0n || fee < 0n || totalDebit <= 0n) {
          throw new RelationalConflictError("INVALID_AMOUNT", "Transfer amount and fee are invalid.");
        }
        const preTransferAvailableMinor = BigInt(source.availableMinor);
        if (preTransferAvailableMinor < totalDebit) {
          throw new RelationalConflictError("INSUFFICIENT_BALANCE", "Insufficient available balance.");
        }

        const riskSignals = await anomalies.getTransferRiskSignals({
          customerId: input.customerId,
          destinationAccountId: destination.id,
          now,
        });
        const anomalyAssessment = evaluateTransferAnomaly({
          amountMinor: amount,
          feeMinor: fee,
          availableBalanceMinor: preTransferAvailableMinor,
          isNewRecipient: !quote.beneficiaryId && !riskSignals.hasPriorRelationship,
          recentTransfersLast10mCount: riskSignals.recentTransfersLast10mCount,
          sameRecipientLast15mCount: riskSignals.sameRecipientLast15mCount,
          occurredAt: now,
        });

        const transferId = input.transferId ?? randomUUID();
        const reference = input.reference ?? `REF-${transferId.slice(-12).toUpperCase()}`;
        const transfer = await transfers.createTransfer({
          id: transferId,
          customerId: input.customerId,
          sourceAccountId: source.id,
          quoteId: quote.id,
          idempotencyKey: input.idempotencyKey,
          requestFingerprint: input.requestFingerprint,
          reference,
          amountMinor: amount.toString(),
          feeMinor: fee.toString(),
          status: "SUCCEEDED",
          destinationAccountId: destination.id,
          destinationOwnerId: destination.customerId,
          sourceTransactionId: randomUUID(),
          destinationTransactionId: randomUUID(),
          heldMinor: "0",
        });
        await input.fault?.("after_transfer_inserted");

        if (!(await transfers.consumeQuote(quote.id, transfer.id))) {
          throw new RelationalConflictError("QUOTE_ALREADY_CONSUMED", "Transfer quote was consumed concurrently.");
        }
        await client.query(
          "DELETE FROM recipient_lookups WHERE customer_id = $1 AND destination_account_id = $2",
          [input.customerId, destination.id],
        );
        await input.fault?.("after_quote_consumed");

        await accounts.updateBalances(source.id, {
          availableMinor: (BigInt(source.availableMinor) - totalDebit).toString(),
          currentMinor: (BigInt(source.currentMinor) - totalDebit).toString(),
          heldMinor: source.heldMinor,
          expectedVersion: source.version,
        });
        await accounts.updateBalances(destination.id, {
          availableMinor: (BigInt(destination.availableMinor) + amount).toString(),
          currentMinor: (BigInt(destination.currentMinor) + amount).toString(),
          heldMinor: destination.heldMinor,
          expectedVersion: destination.version,
        });
        await input.fault?.("after_balance_updated");

        const senderResult = await client.query<{ full_name: string }>(
          "SELECT full_name FROM customers WHERE id = $1",
          [input.customerId],
        );
        const senderName = String(senderResult.rows[0]?.full_name ?? "");
        await accounts.appendTransaction({
          id: transfer.sourceTransactionId!,
          accountId: source.id,
          transferId: transfer.id,
          direction: "DEBIT",
          amountMinor: amount.toString(),
          feeMinor: fee.toString(),
          status: "SUCCEEDED",
          description: input.description ?? "Chuyển tiền nội bộ",
          counterpartyName: quote.destinationOwnerName || null,
          reference,
          occurredAt: now,
          completedAt: now,
          kind: "TRANSFER",
        });
        await accounts.appendTransaction({
          id: transfer.destinationTransactionId!,
          accountId: destination.id,
          transferId: transfer.id,
          direction: "CREDIT",
          amountMinor: amount.toString(),
          feeMinor: "0",
          status: "SUCCEEDED",
          description: "Nhận tiền chuyển khoản nội bộ",
          counterpartyName: senderName || null,
          reference,
          occurredAt: now,
          completedAt: now,
          kind: "TRANSFER",
        });

        const journalId = randomUUID();
        await ledger.appendJournal({
          id: journalId,
          aggregateId: transfer.id,
          journalType: "TRANSFER",
          occurredAt: now,
        });
        const ledgerEntries = [
          {
            lineNumber: 1,
            accountRef: source.id,
            side: "DEBIT" as const,
            amountMinor: totalDebit.toString(),
            entryId: randomUUID(),
          },
          {
            lineNumber: 2,
            accountRef: destination.id,
            side: "CREDIT" as const,
            amountMinor: amount.toString(),
            entryId: randomUUID(),
          },
        ];
        if (fee > 0n) {
          ledgerEntries.push({
            lineNumber: 3,
            accountRef: "fee-income:VND",
            side: "CREDIT" as const,
            amountMinor: fee.toString(),
            entryId: randomUUID(),
          });
        }
        await ledger.appendEntries(journalId, ledgerEntries);
        await input.fault?.("after_ledger_written");

        await audit.append({
          id: randomUUID(),
          eventType: "TRANSFER_SUBMITTED",
          actorCustomerId: input.customerId,
          resourceId: transfer.id,
          occurredAt: now,
          payload: { traceId: input.traceId ?? null },
        });
        await input.fault?.("after_audit_written");

        const senderNotificationId = randomUUID();
        const recipientNotificationId = randomUUID();
        await client.query(
          `INSERT INTO notifications
             (id, customer_id, notification_type, title, body, resource_id,
              resource_account_id, is_read, created_at)
           VALUES
             ($1, $2, 'TRANSFER', 'Chuyển tiền thành công',
              'Giao dịch chuyển tiền nội bộ đã hoàn tất.', $3, $4, false, $5),
           ($6, $7, 'TRANSFER', 'Bạn nhận được tiền chuyển khoản',
              'Tài khoản của bạn đã nhận một giao dịch chuyển tiền nội bộ.', $9, $8, false, $5)`,
          [
            senderNotificationId,
            input.customerId,
            transfer.sourceTransactionId,
            source.id,
            now,
            recipientNotificationId,
            destination.customerId,
            destination.id,
            transfer.destinationTransactionId,
          ],
        );

        await outbox.append({
          id: randomUUID(),
          eventType: "TRANSFER_SUCCEEDED",
          aggregateId: transfer.id,
          deduplicationKey: `TRANSFER_SUCCEEDED:${transfer.id}`,
          occurredAt: now,
          payload: { transferId: transfer.id, reference },
          traceId: input.traceId,
          subjectCustomerIds: [input.customerId, destination.customerId],
          notificationIds: [senderNotificationId, recipientNotificationId],
        });
        await input.fault?.("after_outbox_written");

        if (anomalyAssessment.flagged && anomalyAssessment.riskLevel !== "LOW") {
          const anomalyRecord = await anomalies.insertAnomaly({
            id: randomUUID(),
            customerId: input.customerId,
            accountId: source.id,
            transferId: transfer.id,
            transactionId: transfer.sourceTransactionId,
            amountMinor: amount.toString(),
            counterpartyName: quote.destinationOwnerName || null,
            maskedDestinationAccount: destination.maskedNumber ?? null,
            riskLevel: anomalyAssessment.riskLevel,
            riskScore: anomalyAssessment.riskScore,
            ruleCodes: anomalyAssessment.flags.map((flag) => flag.code),
            summary: anomalyAssessment.summary,
            flags: anomalyAssessment.flags,
            now,
          });
          const anomalyNotificationId = randomUUID();
          await client.query(
            `INSERT INTO notifications
               (id, customer_id, notification_type, title, body, resource_id,
                resource_account_id, is_read, created_at)
             VALUES
               ($1, $2, 'SECURITY', 'Cảnh báo giao dịch bất thường', $3, $4, NULL, false, $5)`,
            [
              anomalyNotificationId,
              input.customerId,
              anomalyAssessment.summary,
              anomalyRecord.id,
              now,
            ],
          );
          await audit.append({
            id: randomUUID(),
            eventType: "TRANSACTION_ANOMALY_DETECTED",
            actorCustomerId: input.customerId,
            resourceId: anomalyRecord.id,
            occurredAt: now,
            traceId: input.traceId,
            payload: {
              transferId: transfer.id,
              riskLevel: anomalyAssessment.riskLevel,
              riskScore: anomalyAssessment.riskScore,
              ruleCodes: anomalyAssessment.flags.map((flag) => flag.code),
            },
          });
          await outbox.append({
            id: randomUUID(),
            eventType: "SECURITY_ANOMALY_DETECTED",
            aggregateType: "security",
            aggregateId: anomalyRecord.id,
            deduplicationKey: `SECURITY_ANOMALY_DETECTED:${anomalyRecord.id}`,
            occurredAt: now,
            payload: {
              anomalyId: anomalyRecord.id,
              transferId: transfer.id,
              riskLevel: anomalyAssessment.riskLevel,
              riskScore: anomalyAssessment.riskScore,
            },
            traceId: input.traceId,
            subjectCustomerIds: [input.customerId],
            notificationIds: [anomalyNotificationId],
          });
        }

        const resultWithAssessment: TransferRowWithAssessment = {
          ...transfer,
          anomalyAssessment,
        };
        await transfers.completeCommandIdempotency(input.customerId, "TRANSFER_SUBMIT", input.idempotencyKey, {
          aggregateId: transfer.id,
          status: transfer.status,
          responsePayload: resultWithAssessment,
        });
        return resultWithAssessment;
      },
      { traceId: input.traceId, maxRetries: 1 },
    );
  }

  async get(customerId: string, transferId: string): Promise<TransferReceipt> {
    assertUuid(transferId, "transferId");
    return this.unitOfWork.transaction(async ({ client }) => {
      const result = await client.query(
        "SELECT * FROM transfers WHERE id = $1 AND customer_id = $2",
        [transferId, customerId],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      if (!row) throw notFound("Transfer not found.");
      const mapped = await new TransferRepository(client).findById(String(row.id));
      if (!mapped) throw notFound("Transfer not found.");
      return publicTransfer(mapped);
    });
  }

  async getStepUpRequestFingerprint(quoteId: string): Promise<string | null> {
    assertUuid(quoteId, "quoteId");
    return this.unitOfWork.transaction(async ({ client }) => {
      const quote = await new TransferRepository(client).findQuoteForUpdate(quoteId);
      return quote?.requestFingerprint ?? null;
    });
  }

  toPublic(row: TransferRowWithAssessment): TransferReceipt {
    return publicTransfer(row);
  }
}
