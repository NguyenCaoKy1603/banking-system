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
import {
  defaultNapasGateway,
  type MockNapasGateway,
  type NapasSettlementResult,
} from "../domain/napas/mockNapasGateway.js";
import { createOpaqueToken, fingerprint, hashOpaqueToken } from "../security.js";
import { parseMoney, toMoney } from "../domain/money.js";
import type {
  Beneficiary,
  InternalRecipientLookup,
  TransferAnomalyAssessment,
  TransferQuote,
  TransferReceipt,
} from "../types.js";
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
  confirmHighRisk?: boolean;
  traceId?: string;
  napasGateway?: MockNapasGateway;
  fault?: (point: TransferFaultPoint) => void | Promise<void>;
};

export type ExternalRecipientLookupResult = InternalRecipientLookup & {
  rail: "NAPAS_IBFT";
  bankBin: string;
  bankCode: string;
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
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly napasGateway: MockNapasGateway = defaultNapasGateway,
  ) {}

  async lookupExternalRecipient(
    customerId: string,
    input: { bankBin: unknown; accountNumber: unknown },
    gateway: MockNapasGateway = this.napasGateway,
  ): Promise<ExternalRecipientLookupResult> {
    const inquiry = gateway.inquireAccount(input.bankBin, input.accountNumber);
    return this.unitOfWork.transaction(async ({ client }) => {
      await client.query("DELETE FROM recipient_lookups WHERE expires_at <= NOW()");
      const lookupId = createOpaqueToken();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      await client.query(
        `INSERT INTO recipient_lookups
          (token_hash, customer_id, destination_account_id, destination_owner_id,
           account_holder_name, masked_account_number, bank_name, status, expires_at,
           rail, bank_bin, external_account_number)
         VALUES ($1, $2, NULL, NULL, $3, $4, $5, 'ACTIVE', $6, 'NAPAS_IBFT', $7, $8)`,
        [
          hashOpaqueToken(lookupId),
          customerId,
          inquiry.accountHolderName,
          inquiry.maskedAccountNumber,
          inquiry.bank.name,
          expiresAt,
          inquiry.bank.bin,
          inquiry.accountNumber,
        ],
      );
      await new AuditRepository(client).append({
        id: randomUUID(),
        eventType: "EXTERNAL_RECIPIENT_LOOKED_UP",
        actorCustomerId: customerId,
        resourceId: `${inquiry.bank.bin}:${inquiry.maskedAccountNumber}`,
        occurredAt: new Date().toISOString(),
        payload: { bankBin: inquiry.bank.bin, bankCode: inquiry.bank.code },
      });
      return {
        lookupId,
        rail: "NAPAS_IBFT",
        bankBin: inquiry.bank.bin,
        bankCode: inquiry.bank.code,
        accountHolderName: inquiry.accountHolderName,
        maskedAccountNumber: inquiry.maskedAccountNumber,
        bankName: inquiry.bank.name,
        status: "ACTIVE",
        expiresAt,
      };
    });
  }

  async createQuote(input: TransferQuoteCommandInput): Promise<TransferQuote> {
    assertUuid(input.sourceAccountId, "sourceAccountId");
    const hasBeneficiary = typeof input.beneficiaryId === "string" && input.beneficiaryId.trim().length > 0;
    const hasLookup = typeof input.lookupId === "string" && input.lookupId.trim().length > 0;
    if (hasBeneficiary === hasLookup) throw invalidRequest("Exactly one recipient reference is required.");
    if (hasBeneficiary) assertUuid(input.beneficiaryId!, "beneficiaryId");
    const amountMinor = parseMoney(input.amount, "amount");
    if (amountMinor <= 0n) throw conflict("Transfer amount is outside the sandbox limit.");
    const now = input.now ?? new Date().toISOString();
    return this.unitOfWork.transaction(async ({ client }) => {
      const policyRepo = new ControlPolicyRepository(client);
      const policy = await policyRepo.assertTransferAllowed(input.customerId, amountMinor);
      const feeMinor = policyRepo.getTransferFeeMinor(policy);
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

      const rail = String(destination.rail ?? "INTERNAL") === "NAPAS_IBFT" ? "NAPAS_IBFT" : "INTERNAL";
      if (rail === "NAPAS_IBFT") {
        const externalBankBin = String(destination.bank_bin ?? "");
        const externalBankName = String(destination.bank_name ?? "NAPAS");
        const externalAccountNumber = String(destination.external_account_number ?? "");
        const accountHolderName = String(destination.account_holder_name ?? "");
        const beneficiary: Beneficiary = {
          id: input.lookupId!,
          displayName: accountHolderName,
          accountHolderName,
          maskedAccountNumber: String(destination.masked_account_number),
          bankName: externalBankName,
          status: String(destination.status) as Beneficiary["status"],
        };
        const quoteId = randomUUID();
        const expiresAt = new Date(Date.parse(now) + 5 * 60 * 1000).toISOString();
        const requestFingerprint = fingerprint({ quoteId, amountMinor: amountMinor.toString() });
        await client.query(
          `INSERT INTO transfer_quotes
            (id, customer_id, source_account_id, beneficiary_id, amount_minor,
             fee_minor, currency, expires_at, created_at, request_fingerprint,
             beneficiary_snapshot, destination_account_id, destination_owner_id,
             destination_owner_name, rail, external_bank_bin, external_bank_name,
             external_account_number)
           VALUES ($1, $2, $3, NULL, $4, $5, 'VND', $6, NOW(), $7, $8::jsonb, NULL, NULL, $9, 'NAPAS_IBFT', $10, $11, $12)`,
          [
            quoteId,
            input.customerId,
            source.id,
            amountMinor.toString(),
            feeMinor.toString(),
            expiresAt,
            requestFingerprint,
            JSON.stringify(beneficiary),
            accountHolderName,
            externalBankBin,
            externalBankName,
            externalAccountNumber,
          ],
        );
        const velocityResult = await client.query<{ recent_10m: number; same_recipient_15m: number }>(
          `SELECT
             COUNT(*) FILTER (WHERE created_at >= ($2::timestamptz - interval '10 minutes'))::int AS recent_10m,
             COUNT(*) FILTER (
               WHERE external_bank_bin = $3
                 AND external_account_number = $4
                 AND created_at >= ($2::timestamptz - interval '15 minutes')
             )::int AS same_recipient_15m
           FROM transfers
           WHERE customer_id = $1`,
          [input.customerId, now, externalBankBin, externalAccountNumber],
        );
        const anomalyAssessment = evaluateTransferAnomaly({
          amountMinor,
          feeMinor,
          availableBalanceMinor: BigInt(source.availableMinor),
          isNewRecipient: true,
          recentTransfersLast10mCount: Number(velocityResult.rows[0]?.recent_10m ?? 0),
          sameRecipientLast15mCount: Number(velocityResult.rows[0]?.same_recipient_15m ?? 0),
          occurredAt: now,
        });
        await new AuditRepository(client).append({
          id: randomUUID(),
          eventType: "TRANSFER_QUOTED",
          actorCustomerId: input.customerId,
          resourceId: quoteId,
          occurredAt: now,
          payload: { rail: "NAPAS_IBFT", bankBin: externalBankBin },
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
      }

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
          const quoteMetaResult = await client.query<{
            rail?: string;
            external_bank_bin?: string | null;
            external_bank_name?: string | null;
            external_account_number?: string | null;
            destination_owner_name?: string | null;
          }>(
            `SELECT rail, external_bank_bin, external_bank_name, external_account_number, destination_owner_name
               FROM transfer_quotes
              WHERE id = $1`,
            [quote.id],
          );
          const quoteMeta = quoteMetaResult.rows[0];
          if (
            !quoteMeta ||
            quoteMeta.rail !== "NAPAS_IBFT" ||
            !quoteMeta.external_bank_bin ||
            !quoteMeta.external_account_number
          ) {
            throw new RelationalConflictError(
              "RECIPIENT_NOT_FOUND",
              "The transfer quote has no internal destination account.",
            );
          }

          await new ControlPolicyRepository(client).assertTransferAllowed(
            input.customerId,
            BigInt(quote.amountMinor),
          );

          const source = await accounts.lockById(quote.sourceAccountId);
          if (!source || source.customerId !== input.customerId) {
            throw new RelationalNotFoundError("Transfer account not found.");
          }
          if (source.status !== "ACTIVE") {
            throw new RelationalConflictError("ACCOUNT_NOT_ACTIVE", "Source account must be active.");
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

          const externalBankBin = String(quoteMeta.external_bank_bin);
          const externalBankName = String(quoteMeta.external_bank_name ?? "NAPAS");
          const externalAccountNumber = String(quoteMeta.external_account_number);
          const externalHolderName = String(quoteMeta.destination_owner_name ?? quote.destinationOwnerName ?? "");

          const velocityResult = await client.query<{ recent_10m: number; same_recipient_15m: number }>(
            `SELECT
               COUNT(*) FILTER (WHERE created_at >= ($2::timestamptz - interval '10 minutes'))::int AS recent_10m,
               COUNT(*) FILTER (
                 WHERE external_bank_bin = $3
                   AND external_account_number = $4
                   AND created_at >= ($2::timestamptz - interval '15 minutes')
               )::int AS same_recipient_15m
             FROM transfers
             WHERE customer_id = $1`,
            [input.customerId, now, externalBankBin, externalAccountNumber],
          );
          const anomalyAssessment = evaluateTransferAnomaly({
            amountMinor: amount,
            feeMinor: fee,
            availableBalanceMinor: preTransferAvailableMinor,
            isNewRecipient: true,
            recentTransfersLast10mCount: Number(velocityResult.rows[0]?.recent_10m ?? 0),
            sameRecipientLast15mCount: Number(velocityResult.rows[0]?.same_recipient_15m ?? 0),
            occurredAt: now,
          });
          if (anomalyAssessment.riskLevel === "CRITICAL" && !input.confirmHighRisk) {
            throw new RelationalConflictError(
              "CRITICAL_ANOMALY_BLOCKED",
              "Giao dịch có dấu hiệu bất thường nghiêm trọng (CRITICAL) và đã bị chặn theo chính sách an toàn.",
            );
          }

          // Phase 1: Reserve funds into held_minor and create PENDING interbank transfer
          const transferId = input.transferId ?? randomUUID();
          const reference = input.reference ?? `NAPAS-${transferId.slice(-12).toUpperCase()}`;
          const sourceTransactionId = randomUUID();
          const phase1Account = await accounts.updateBalances(source.id, {
            availableMinor: (preTransferAvailableMinor - totalDebit).toString(),
            currentMinor: source.currentMinor,
            heldMinor: (BigInt(source.heldMinor) + totalDebit).toString(),
            expectedVersion: source.version,
          });

          const transferInsert = await client.query(
            `INSERT INTO transfers
              (id, customer_id, source_account_id, quote_id, idempotency_key,
               request_fingerprint, reference, amount_minor, fee_minor, currency,
               status, created_at, updated_at, destination_account_id,
               destination_owner_id, source_transaction_id, destination_transaction_id,
               ledger_journal_id, held_minor, rail, external_bank_bin,
               external_bank_name, external_account_number, external_account_holder_name)
             VALUES
              ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'VND',
               'PENDING', $10, $10, NULL, NULL, $11, NULL, NULL, $12,
               'NAPAS_IBFT', $13, $14, $15, $16)
             RETURNING *`,
            [
              transferId,
              input.customerId,
              source.id,
              quote.id,
              input.idempotencyKey,
              input.requestFingerprint,
              reference,
              amount.toString(),
              fee.toString(),
              now,
              sourceTransactionId,
              totalDebit.toString(),
              externalBankBin,
              externalBankName,
              externalAccountNumber,
              externalHolderName,
            ],
          );
          void transferInsert;

          if (!(await transfers.consumeQuote(quote.id, transferId))) {
            throw new RelationalConflictError("QUOTE_ALREADY_CONSUMED", "Transfer quote was consumed concurrently.");
          }
          await client.query(
            "DELETE FROM recipient_lookups WHERE customer_id = $1 AND rail = 'NAPAS_IBFT' AND external_account_number = $2",
            [input.customerId, externalAccountNumber],
          );

          await accounts.appendTransaction({
            id: sourceTransactionId,
            accountId: source.id,
            transferId,
            direction: "DEBIT",
            amountMinor: amount.toString(),
            feeMinor: fee.toString(),
            status: "PENDING",
            description: input.description ?? `Chuyển nhanh NAPAS 24/7 tới ${externalBankName}`,
            counterpartyName: externalHolderName || null,
            reference,
            occurredAt: now,
            completedAt: null,
            kind: "TRANSFER",
          });

          const gateway = input.napasGateway ?? this.napasGateway;
          const settlement = gateway.settleTransfer({
            transferId,
            reference,
            bankBin: externalBankBin,
            accountNumber: externalAccountNumber,
            amountMinor: amount.toString(),
            description: input.description ?? `Chuyển nhanh NAPAS 24/7 tới ${externalBankName}`,
          });

          const finalizedRow = await this.finalizeInterbankSettlement(client, {
            transferId,
            customerId: input.customerId,
            quoteId: quote.id,
            idempotencyKey: input.idempotencyKey,
            requestFingerprint: input.requestFingerprint,
            reference,
            sourceTransactionId,
            source: phase1Account,
            amount,
            fee,
            totalDebit,
            externalBankBin,
            externalBankName,
            externalHolderName,
            settlement,
            now,
            traceId: input.traceId,
          });

          const resultWithAssessment: TransferRowWithAssessment = {
            ...finalizedRow,
            anomalyAssessment,
          };
          await transfers.completeCommandIdempotency(input.customerId, "TRANSFER_SUBMIT", input.idempotencyKey, {
            aggregateId: finalizedRow.id,
            status: finalizedRow.status,
            responsePayload: resultWithAssessment,
          });
          return resultWithAssessment;
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
        if (anomalyAssessment.riskLevel === "CRITICAL" && !input.confirmHighRisk) {
          throw new RelationalConflictError(
            "CRITICAL_ANOMALY_BLOCKED",
            "Giao dịch có dấu hiệu bất thường nghiêm trọng (CRITICAL) và đã bị chặn theo chính sách an toàn.",
          );
        }

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
            accountRef: `payment-account:${source.id}`,
            side: "DEBIT" as const,
            amountMinor: totalDebit.toString(),
            entryId: randomUUID(),
          },
          {
            lineNumber: 2,
            accountRef: `payment-account:${destination.id}`,
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

  async reconcilePendingInterbankTransfers(
    asOf = new Date().toISOString(),
    limit = 50,
    gateway: MockNapasGateway = this.napasGateway,
  ): Promise<number> {
    const pendingIds = await this.unitOfWork.transaction(async ({ client }) => {
      const result = await client.query<{ id: string }>(
        `SELECT id
           FROM transfers
          WHERE rail = 'NAPAS_IBFT'
            AND status = 'PENDING'
            AND held_minor > 0
          ORDER BY created_at, id
          LIMIT $1
          FOR UPDATE SKIP LOCKED`,
        [limit],
      );
      return result.rows.map((row) => row.id);
    });

    let reconciled = 0;
    for (const transferId of pendingIds) {
      const updated = await this.unitOfWork.transaction(async ({ client }) => {
        const result = await client.query<Record<string, unknown>>(
          "SELECT * FROM transfers WHERE id = $1 FOR UPDATE",
          [transferId],
        );
        const row = result.rows[0];
        if (!row || String(row.status) !== "PENDING" || String(row.rail) !== "NAPAS_IBFT") {
          return false;
        }
        const accounts = new AccountRepository(client);
        const source = await accounts.lockById(String(row.source_account_id));
        if (!source) return false;

        const amount = BigInt(String(row.amount_minor));
        const fee = BigInt(String(row.fee_minor));
        const totalDebit = amount + fee;
        const settlement = gateway.inquirePendingSettlement({
          reference: String(row.reference),
          accountNumber: String(row.external_account_number ?? ""),
          napasTraceId: row.napas_trace_id ? String(row.napas_trace_id) : null,
        });
        if (settlement.status === "PENDING") return false;

        await this.finalizeInterbankSettlement(client, {
          transferId: String(row.id),
          customerId: String(row.customer_id),
          quoteId: String(row.quote_id),
          idempotencyKey: String(row.idempotency_key),
          requestFingerprint: String(row.request_fingerprint),
          reference: String(row.reference),
          sourceTransactionId: String(row.source_transaction_id),
          source,
          amount,
          fee,
          totalDebit,
          externalBankBin: String(row.external_bank_bin ?? ""),
          externalBankName: String(row.external_bank_name ?? "NAPAS"),
          externalHolderName: String(row.external_account_holder_name ?? ""),
          settlement,
          now: asOf,
        });
        return true;
      }, { maxRetries: 1 });
      if (updated) reconciled += 1;
    }
    return reconciled;
  }

  private async finalizeInterbankSettlement(
    client: import("pg").PoolClient,
    params: {
      transferId: string;
      customerId: string;
      quoteId: string;
      idempotencyKey: string;
      requestFingerprint: string;
      reference: string;
      sourceTransactionId: string;
      source: import("./repositories/accountRepository.js").AccountRow;
      amount: bigint;
      fee: bigint;
      totalDebit: bigint;
      externalBankBin: string;
      externalBankName: string;
      externalHolderName: string;
      settlement: NapasSettlementResult;
      now: string;
      traceId?: string;
    },
  ): Promise<TransferRow> {
    const accounts = new AccountRepository(client);
    const transfers = new TransferRepository(client);
    const ledger = new LedgerRepository(client);
    const audit = new AuditRepository(client);
    const outbox = new OutboxRepository(client);

    if (params.settlement.status === "SUCCEEDED") {
      await accounts.updateBalances(params.source.id, {
        availableMinor: params.source.availableMinor,
        currentMinor: (BigInt(params.source.currentMinor) - params.totalDebit).toString(),
        heldMinor: (BigInt(params.source.heldMinor) - params.totalDebit).toString(),
        expectedVersion: params.source.version,
      });

      const journalId = randomUUID();
      await ledger.appendJournal({
        id: journalId,
        aggregateId: params.transferId,
        journalType: "NAPAS_TRANSFER",
        occurredAt: params.now,
      });
      const ledgerEntries = [
        {
          lineNumber: 1,
          accountRef: `payment-account:${params.source.id}`,
          side: "DEBIT" as const,
          amountMinor: params.totalDebit.toString(),
          entryId: randomUUID(),
        },
        {
          lineNumber: 2,
          accountRef: "napas-clearing:VND",
          side: "CREDIT" as const,
          amountMinor: params.amount.toString(),
          entryId: randomUUID(),
        },
      ];
      if (params.fee > 0n) {
        ledgerEntries.push({
          lineNumber: 3,
          accountRef: "fee-income:VND",
          side: "CREDIT" as const,
          amountMinor: params.fee.toString(),
          entryId: randomUUID(),
        });
      }
      await ledger.appendEntries(journalId, ledgerEntries);

      await client.query(
        `UPDATE transfers
            SET status = 'SUCCEEDED',
                held_minor = 0,
                ledger_journal_id = $2,
                napas_trace_id = $3,
                updated_at = $4
          WHERE id = $1`,
        [params.transferId, journalId, params.settlement.napasTraceId, params.now],
      );
      await client.query(
        `UPDATE account_transactions
            SET status = 'SUCCEEDED',
                completed_at = $2
          WHERE id = $1`,
        [params.sourceTransactionId, params.now],
      );
      await audit.append({
        id: randomUUID(),
        eventType: "TRANSFER_NAPAS_SUCCEEDED",
        actorCustomerId: params.customerId,
        resourceId: params.transferId,
        occurredAt: params.now,
        payload: {
          traceId: params.traceId ?? null,
          napasTraceId: params.settlement.napasTraceId,
          bankBin: params.externalBankBin,
        },
      });
      const notificationId = randomUUID();
      await client.query(
        `INSERT INTO notifications
           (id, customer_id, notification_type, title, body, resource_id,
            resource_account_id, is_read, created_at)
         VALUES
           ($1, $2, 'TRANSFER', 'Chuyển nhanh NAPAS 24/7 thành công', $3, $4, $5, false, $6)`,
        [
          notificationId,
          params.customerId,
          `Giao dịch tới ${params.externalHolderName} (${params.externalBankName}) đã hoàn tất.`,
          params.sourceTransactionId,
          params.source.id,
          params.now,
        ],
      );
      await outbox.append({
        id: randomUUID(),
        eventType: "TRANSFER_SUCCEEDED",
        aggregateId: params.transferId,
        deduplicationKey: `TRANSFER_SUCCEEDED:${params.transferId}`,
        occurredAt: params.now,
        payload: {
          transferId: params.transferId,
          reference: params.reference,
          rail: "NAPAS_IBFT",
          napasTraceId: params.settlement.napasTraceId,
        },
        traceId: params.traceId,
        subjectCustomerIds: [params.customerId],
        notificationIds: [notificationId],
      });
    } else if (params.settlement.status === "FAILED") {
      await accounts.updateBalances(params.source.id, {
        availableMinor: (BigInt(params.source.availableMinor) + params.totalDebit).toString(),
        currentMinor: params.source.currentMinor,
        heldMinor: (BigInt(params.source.heldMinor) - params.totalDebit).toString(),
        expectedVersion: params.source.version,
      });

      const reversalJournalId = randomUUID();
      await ledger.appendJournal({
        id: reversalJournalId,
        aggregateId: params.transferId,
        journalType: "NAPAS_TRANSFER_REVERSAL",
        occurredAt: params.now,
      });
      await ledger.appendEntries(reversalJournalId, [
        {
          lineNumber: 1,
          accountRef: "napas-hold-clearing:VND",
          side: "DEBIT" as const,
          amountMinor: params.totalDebit.toString(),
          entryId: randomUUID(),
        },
        {
          lineNumber: 2,
          accountRef: `payment-account:${params.source.id}`,
          side: "CREDIT" as const,
          amountMinor: params.totalDebit.toString(),
          entryId: randomUUID(),
        },
      ]);

      await client.query(
        `UPDATE transfers
            SET status = 'REVERSED',
                refunded = true,
                held_minor = 0,
                ledger_journal_id = $2,
                napas_trace_id = $3,
                failure_reason = $4,
                updated_at = $5
          WHERE id = $1`,
        [
          params.transferId,
          reversalJournalId,
          params.settlement.napasTraceId,
          params.settlement.failureReason ?? "NAPAS_SETTLEMENT_FAILED",
          params.now,
        ],
      );
      await client.query(
        `UPDATE account_transactions
            SET status = 'REVERSED',
                completed_at = $2
          WHERE id = $1`,
        [params.sourceTransactionId, params.now],
      );
      const refundTx = await accounts.appendTransaction({
        id: randomUUID(),
        accountId: params.source.id,
        transferId: params.transferId,
        direction: "CREDIT",
        amountMinor: params.totalDebit.toString(),
        feeMinor: "0",
        status: "SUCCEEDED",
        description: `Hoàn tiền chuyển nhanh liên ngân hàng NAPAS thất bại (${params.externalBankName})`,
        counterpartyName: params.externalHolderName || null,
        reference: `REV-${params.reference}`,
        occurredAt: params.now,
        completedAt: params.now,
        kind: "TRANSFER_NAPAS_REVERSAL",
      });
      await audit.append({
        id: randomUUID(),
        eventType: "TRANSFER_NAPAS_REVERSED",
        actorCustomerId: params.customerId,
        resourceId: params.transferId,
        occurredAt: params.now,
        payload: {
          traceId: params.traceId ?? null,
          napasTraceId: params.settlement.napasTraceId,
          failureReason: params.settlement.failureReason,
          refundTransactionId: refundTx.id,
        },
      });
      const notificationId = randomUUID();
      await client.query(
        `INSERT INTO notifications
           (id, customer_id, notification_type, title, body, resource_id,
            resource_account_id, is_read, created_at)
         VALUES
           ($1, $2, 'TRANSFER', 'Hoàn tiền chuyển nhanh NAPAS', $3, $4, $5, false, $6)`,
        [
          notificationId,
          params.customerId,
          `Giao dịch tới ${params.externalBankName} không thành công. Số tiền đã được hoàn trả về tài khoản của bạn.`,
          refundTx.id,
          params.source.id,
          params.now,
        ],
      );
      await outbox.append({
        id: randomUUID(),
        eventType: "TRANSFER_REVERSED",
        aggregateId: params.transferId,
        deduplicationKey: `TRANSFER_REVERSED:${params.transferId}`,
        occurredAt: params.now,
        payload: {
          transferId: params.transferId,
          reference: params.reference,
          failureReason: params.settlement.failureReason,
        },
        traceId: params.traceId,
        subjectCustomerIds: [params.customerId],
        notificationIds: [notificationId],
      });
    } else {
      await client.query(
        `UPDATE transfers
            SET napas_trace_id = $2,
                updated_at = $3
          WHERE id = $1`,
        [params.transferId, params.settlement.napasTraceId, params.now],
      );
      await audit.append({
        id: randomUUID(),
        eventType: "TRANSFER_NAPAS_PENDING",
        actorCustomerId: params.customerId,
        resourceId: params.transferId,
        occurredAt: params.now,
        payload: {
          traceId: params.traceId ?? null,
          napasTraceId: params.settlement.napasTraceId,
        },
      });
    }

    const updated = await transfers.findById(params.transferId);
    if (updated) return updated;
    return {
      id: params.transferId,
      customerId: params.customerId,
      sourceAccountId: params.source.id,
      quoteId: params.quoteId,
      idempotencyKey: params.idempotencyKey,
      requestFingerprint: params.requestFingerprint,
      reference: params.reference,
      amountMinor: params.amount.toString(),
      feeMinor: params.fee.toString(),
      status:
        params.settlement.status === "SUCCEEDED"
          ? "SUCCEEDED"
          : params.settlement.status === "FAILED"
            ? "REVERSED"
            : "PENDING",
      destinationAccountId: null,
      destinationOwnerId: null,
      sourceTransactionId: params.sourceTransactionId,
      destinationTransactionId: null,
      ledgerJournalId: null,
      refunded: params.settlement.status === "FAILED",
      heldMinor: params.settlement.status === "PENDING" ? params.totalDebit.toString() : "0",
      createdAt: params.now,
      updatedAt: params.now,
    };
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
