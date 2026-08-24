import { randomUUID } from "node:crypto";

import { UnitOfWork } from "./unitOfWork.js";
import { IdempotencyConflictError, RelationalConflictError, RelationalNotFoundError } from "./commandErrors.js";
import { AccountRepository } from "./repositories/accountRepository.js";
import { AuditRepository } from "./repositories/auditRepository.js";
import { LedgerRepository } from "./repositories/ledgerRepository.js";
import { OutboxRepository } from "./repositories/outboxRepository.js";
import { TransferRepository, type TransferRow } from "./repositories/transferRepository.js";

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

/**
 * Direct-table transfer use case.  Controllers can keep their existing HTTP
 * contract and pass the authenticated customer/validated quote context here.
 * Every repository in the command receives the UnitOfWork's single client.
 */
export class RelationalTransferService {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  async submit(input: TransferCommandInput): Promise<TransferRow> {
    const now = input.now ?? new Date().toISOString();
    return this.unitOfWork.transaction(
      async ({ client }) => {
        const accounts = new AccountRepository(client);
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
        if (BigInt(source.availableMinor) < totalDebit) {
          throw new RelationalConflictError("INSUFFICIENT_BALANCE", "Insufficient available balance.");
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

        await accounts.appendTransaction({
          id: transfer.sourceTransactionId!,
          accountId: source.id,
          transferId: transfer.id,
          direction: "DEBIT",
          amountMinor: amount.toString(),
          feeMinor: fee.toString(),
          status: "SUCCEEDED",
          description: input.description ?? "Chuyển tiền nội bộ",
          counterpartyName: input.counterpartyName ?? null,
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
          counterpartyName: input.counterpartyName ?? null,
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

        await transfers.completeCommandIdempotency(input.customerId, "TRANSFER_SUBMIT", input.idempotencyKey, {
          aggregateId: transfer.id,
          status: transfer.status,
          responsePayload: transfer,
        });
        return transfer;
      },
      { traceId: input.traceId, maxRetries: 1 },
    );
  }
}
