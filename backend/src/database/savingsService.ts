import { randomUUID } from "node:crypto";

import { buildSavingsQuote, calculateEarlyWithdrawal, toPublicSavingsDeposit, toPublicSavingsOpening, toPublicSavingsQuote, type MaturityInstruction, type SavingsDeposit, type SavingsOpening, type SavingsProduct, type SavingsQuote, type SavingsWithdrawalReceipt } from "../domain/savings/index.js";
import type { SavingsListResult, SavingsQuoteRequest, SubmitSavingsOpeningRequest } from "../bankingSystem.js";
import { conflict, invalidRequest, notFound } from "../errors.js";
import { fingerprint } from "../security.js";
import { parseMoney, toMoney } from "../domain/money.js";
import { UnitOfWork } from "./unitOfWork.js";
import { AccountRepository } from "./repositories/accountRepository.js";
import { AuditRepository } from "./repositories/auditRepository.js";
import { LedgerRepository } from "./repositories/ledgerRepository.js";
import { OutboxRepository } from "./repositories/outboxRepository.js";
import { SavingsRepository, type SavingsDepositRow, type SavingsOpeningRow, type SavingsProductRow, type SavingsQuoteRow } from "./repositories/savingsRepository.js";
import { IdempotencyConflictError, RelationalConflictError, RelationalNotFoundError } from "./commandErrors.js";
import { ControlPolicyRepository } from "./controlPolicyRepository.js";

const QUOTE_TTL_MS = 5 * 60 * 1000;

export type SavingsFaultPoint =
  | "after_idempotency_reserved"
  | "after_quote_consumed"
  | "after_balance_updated"
  | "after_deposit_inserted"
  | "after_ledger_written"
  | "after_outbox_written";

function productToPublic(product: SavingsProductRow): SavingsProduct {
  return {
    productId: product.productCode,
    name: product.name,
    termMonths: product.termMonths,
    annualRateBasisPoints: product.annualRateBasisPoints,
    currency: "VND",
    minAmountMinor: product.minAmountMinor,
    maxAmountMinor: product.maxAmountMinor,
    status: product.status,
    termsVersion: product.termsVersion,
  };
}

function quoteToPublic(row: SavingsQuoteRow): SavingsQuote {
  return toPublicSavingsQuote({
    quoteId: row.id,
    productId: row.productCode,
    productName: row.productName,
    termsVersion: row.termsVersion,
    termMonths: row.termMonths,
    sourceAccountId: row.sourceAccountId,
    sourceAccountMaskedNumber: row.sourceAccountMaskedNumber,
    principal: toMoney(BigInt(row.principalMinor)),
    annualRateBasisPoints: row.annualRateBasisPoints,
    interestDays: row.interestDays,
    expectedInterest: toMoney(BigInt(row.expectedInterestMinor)),
    totalAtMaturity: toMoney(BigInt(row.totalAtMaturityMinor)),
    openedAt: row.openedAt,
    maturityAt: row.maturityAt,
    maturityInstruction: row.maturityInstruction,
    expiresAt: row.expiresAt,
    userId: row.customerId,
    fingerprint: row.requestFingerprint,
    consumedOpeningId: null,
  });
}

function openingToPublic(row: SavingsOpeningRow): SavingsOpening {
  return toPublicSavingsOpening({
    openingId: row.id,
    quoteId: row.quoteId,
    depositId: row.depositId,
    status: row.status,
    reference: row.reference,
    failureReason: row.failureReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    userId: row.customerId,
    idempotencyKey: row.idempotencyKey,
  });
}

function depositToPublic(row: SavingsDepositRow): SavingsDeposit {
  return toPublicSavingsDeposit({
    depositId: row.id,
    productId: row.productCode,
    productName: row.productName,
    termsVersion: row.termsVersion,
    termMonths: row.termMonths,
    principal: toMoney(BigInt(row.principalMinor)),
    annualRateBasisPoints: row.annualRateBasisPoints,
    expectedInterest: toMoney(BigInt(row.expectedInterestMinor)),
    totalAtMaturity: toMoney(BigInt(row.totalAtMaturityMinor)),
    openedAt: row.openedAt,
    maturityAt: row.maturityAt,
    maturityInstruction: row.maturityInstruction,
    sourceAccountMaskedNumber: row.sourceAccountMaskedNumber,
    status: row.status,
    reference: row.reference,
    updatedAt: row.updatedAt,
    renewedDepositId: row.renewedDepositId,
    earlyWithdrawnAt: row.earlyWithdrawnAt ?? null,
    earlyInterest: row.earlyInterestMinor ? toMoney(BigInt(row.earlyInterestMinor)) : null,
    userId: row.customerId,
    sourceAccountId: row.sourceAccountId,
    openingId: row.openingId,
  });
}

function requireIdempotencyKey(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 16 || normalized.length > 128) {
    throw invalidRequest("Idempotency-Key must contain between 16 and 128 characters.");
  }
  return normalized;
}

function parseInstruction(value: unknown): MaturityInstruction {
  if (value === "RETURN_PRINCIPAL_AND_INTEREST" || value === "RENEW_PRINCIPAL" || value === "RENEW_PRINCIPAL_AND_INTEREST") return value;
  throw invalidRequest("maturityInstruction is invalid.", { maturityInstruction: "maturityInstruction is invalid." });
}

function assertUuid(value: string, field: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw invalidRequest(`${field} is invalid.`, { [field]: `${field} must be a UUID.` });
  }
}

/**
 * Savings use case backed entirely by the relational tables.  The command
 * deliberately keeps idempotency, quote consumption, account lock, balance,
 * deposit, ledger, audit and outbox writes in one UnitOfWork transaction.
 */
export class RelationalSavingsService {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  async listProducts(customerId: string): Promise<SavingsProduct[]> {
    return this.unitOfWork.transaction(async ({ client }) => {
      return (await new SavingsRepository(client).listProducts()).filter((item) => item.status === "ACTIVE").map(productToPublic);
    });
  }

  async createQuote(customerId: string, input: SavingsQuoteRequest): Promise<SavingsQuote> {
    const sourceAccountId = typeof input.sourceAccountId === "string" ? input.sourceAccountId : "";
    const productCode = typeof input.productId === "string" ? input.productId.trim() : "";
    assertUuid(sourceAccountId, "sourceAccountId");
    if (!productCode) throw invalidRequest("productId is required.");
    const principalMinor = parseMoney(input.principal, "principal");
    const maturityInstruction = parseInstruction(input.maturityInstruction);
    return this.unitOfWork.transaction(async ({ client }) => {
      const policy = new ControlPolicyRepository(client);
      const maxAmount = BigInt((await policy.read()).max_savings_amount_minor);
      await policy.assertSavingsOpeningAllowed(customerId, principalMinor);
      const savings = new SavingsRepository(client);
      const product = await savings.findActiveProduct(productCode);
      if (!product) throw notFound("Savings product not found.");
      const minAmount = BigInt(product.minAmountMinor);
      const maxAllowed = BigInt(product.maxAmountMinor) < maxAmount ? BigInt(product.maxAmountMinor) : maxAmount;
      if (principalMinor < minAmount || principalMinor > maxAllowed) throw conflict("Savings principal is outside the sandbox limit.");
      const account = await new AccountRepository(client).findOwnedAccount(customerId, sourceAccountId);
      if (!account) throw notFound("Account not found.");
      if (account.status !== "ACTIVE") throw conflict("The source account is not active.");
      const openedAt = new Date().toISOString();
      const quote = buildSavingsQuote({
        quoteId: randomUUID(),
        product: productToPublic(product),
        sourceAccountId: account.id,
        sourceAccountMaskedNumber: account.maskedNumber,
        principalMinor,
        openedAt,
        maturityInstruction,
        expiresAt: new Date(Date.parse(openedAt) + QUOTE_TTL_MS).toISOString(),
      });
      const persisted = await savings.createQuote({
        id: quote.quoteId,
        customerId,
        sourceAccountId: account.id,
        productId: product.id,
        principalMinor: quote.principal.amountMinor,
        annualRateBasisPoints: quote.annualRateBasisPoints,
        interestDays: quote.interestDays,
        expectedInterestMinor: quote.expectedInterest.amountMinor,
        totalAtMaturityMinor: quote.totalAtMaturity.amountMinor,
        termMonths: quote.termMonths,
        maturityInstruction: quote.maturityInstruction,
        termsVersion: quote.termsVersion,
        openedAt: quote.openedAt,
        maturityAt: quote.maturityAt,
        expiresAt: quote.expiresAt,
        requestFingerprint: fingerprint({ quoteId: quote.quoteId }),
      });
      await new AuditRepository(client).append({ id: randomUUID(), eventType: "SAVINGS_QUOTED", actorCustomerId: customerId, resourceId: quote.quoteId, occurredAt: openedAt });
      return quoteToPublic(persisted);
    }, { maxRetries: 1 });
  }

  async getQuoteStepUpRequestFingerprint(quoteId: string): Promise<string | null> {
    assertUuid(quoteId, "quoteId");
    return this.unitOfWork.transaction(async ({ client }) => (await new SavingsRepository(client).findQuote(quoteId))?.requestFingerprint ?? null);
  }

  async submitOpening(input: { customerId: string; idempotencyKey: string; request: SubmitSavingsOpeningRequest; traceId?: string; fault?: (point: SavingsFaultPoint) => void | Promise<void> }): Promise<SavingsOpening> {
    const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
    const quoteId = typeof input.request.quoteId === "string" ? input.request.quoteId : "";
    assertUuid(quoteId, "quoteId");
    const requestFingerprint = fingerprint({ quoteId });
    return this.unitOfWork.transaction(async ({ client }) => {
      const savings = new SavingsRepository(client);
      const reservation = await savings.reserveIdempotency({ id: randomUUID(), customerId: input.customerId, operationType: "SAVINGS_OPENING", idempotencyKey, requestFingerprint });
      if (!reservation.created) {
        if (String(reservation.record.request_fingerprint) !== requestFingerprint) throw new IdempotencyConflictError();
        const existingOpening = reservation.record.opening_id
          ? await savings.findOpening(String(reservation.record.opening_id), input.customerId)
          : await savings.findOpeningByIdempotency(input.customerId, idempotencyKey);
        if (existingOpening) return openingToPublic(existingOpening);
        throw new RelationalConflictError("IDEMPOTENCY_IN_PROGRESS", "The savings opening is still being finalized; retry with the same key.");
      }
      await input.fault?.("after_idempotency_reserved");

      const quote = await savings.lockQuote(quoteId);
      if (!quote || quote.customerId !== input.customerId) throw new RelationalNotFoundError("Savings quote not found.");
      await new ControlPolicyRepository(client).assertSavingsOpeningAllowed(input.customerId, BigInt(quote.principalMinor));
      const existingByQuote = await client.query<{ id: string }>("SELECT id FROM savings_openings WHERE quote_id = $1", [quoteId]);
      if (existingByQuote.rows[0]) {
        const opening = await savings.findOpening(String(existingByQuote.rows[0].id), input.customerId);
        if (!opening) throw new RelationalConflictError("IDEMPOTENCY_STATE_MISSING", "The consumed quote has no savings opening.");
        await savings.completeIdempotency(input.customerId, "SAVINGS_OPENING", idempotencyKey, { openingId: opening.id, status: opening.status, responsePayload: openingToPublic(opening) });
        return openingToPublic(opening);
      }
      if (Date.parse(quote.expiresAt) <= Date.now()) throw new RelationalConflictError("QUOTE_EXPIRED", "Savings quote has expired.");

      const accounts = new AccountRepository(client);
      const source = await accounts.lockById(quote.sourceAccountId);
      if (!source || source.customerId !== input.customerId) throw new RelationalNotFoundError("Account not found.");
      if (source.status !== "ACTIVE") throw new RelationalConflictError("ACCOUNT_NOT_ACTIVE", "The source account is not active.");
      const principal = BigInt(quote.principalMinor);
      if (BigInt(source.availableMinor) < principal) throw new RelationalConflictError("INSUFFICIENT_BALANCE", "Insufficient available balance.");

      const openingId = randomUUID();
      const depositId = randomUUID();
      const reference = `SAV-${openingId.slice(-12).toUpperCase()}`;
      let opening = await savings.createOpening({ id: openingId, customerId: input.customerId, quoteId, idempotencyKey, requestFingerprint, reference });
      if (!(await savings.consumeQuote(quoteId, openingId))) throw new RelationalConflictError("QUOTE_ALREADY_CONSUMED", "Savings quote was consumed concurrently.");
      await input.fault?.("after_quote_consumed");
      const updatedAccount = await accounts.updateBalances(source.id, {
        availableMinor: (BigInt(source.availableMinor) - principal).toString(),
        currentMinor: (BigInt(source.currentMinor) - principal).toString(),
        heldMinor: source.heldMinor,
        expectedVersion: source.version,
      });
      await input.fault?.("after_balance_updated");
      const deposit = await savings.createDeposit({
        id: depositId,
        customerId: input.customerId,
        openingId,
        sourceAccountId: source.id,
        productId: quote.productId,
        principalMinor: quote.principalMinor,
        annualRateBasisPoints: quote.annualRateBasisPoints,
        expectedInterestMinor: quote.expectedInterestMinor,
        totalAtMaturityMinor: quote.totalAtMaturityMinor,
        termMonths: quote.termMonths,
        maturityInstruction: quote.maturityInstruction,
        termsVersion: quote.termsVersion,
        reference,
        openedAt: quote.openedAt,
        maturityAt: quote.maturityAt,
      });
      await input.fault?.("after_deposit_inserted");
      const transactionId = randomUUID();
      await accounts.appendTransaction({
        id: transactionId,
        accountId: source.id,
        savingsOpeningId: openingId,
        savingsDepositId: depositId,
        direction: "DEBIT",
        amountMinor: principal.toString(),
        feeMinor: "0",
        status: "SUCCEEDED",
        description: `Mở tiết kiệm ${quote.productName}`,
        reference,
        occurredAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        kind: "SAVINGS",
      });
      opening = await savings.updateOpening({ id: openingId, status: "SUCCEEDED", depositId, reference });

      const journalId = randomUUID();
      await new LedgerRepository(client).appendJournal({ id: journalId, aggregateId: openingId, journalType: "SAVINGS_OPENING", occurredAt: opening.updatedAt });
      await new LedgerRepository(client).appendEntries(journalId, [
        { lineNumber: 1, accountRef: `payment-account:${updatedAccount.id}`, side: "DEBIT", amountMinor: principal.toString(), entryId: randomUUID(), occurredAt: opening.updatedAt },
        { lineNumber: 2, accountRef: `savings-deposit:${deposit.id}`, side: "CREDIT", amountMinor: principal.toString(), entryId: randomUUID(), occurredAt: opening.updatedAt },
      ]);
      await input.fault?.("after_ledger_written");
      await new AuditRepository(client).append({ id: randomUUID(), eventType: "SAVINGS_OPENING_SUCCEEDED", actorCustomerId: input.customerId, resourceId: openingId, occurredAt: opening.updatedAt, payload: { traceId: input.traceId ?? null } });
      const notificationId = randomUUID();
      await client.query(
        `INSERT INTO notifications
          (id, customer_id, notification_type, title, body, resource_id,
           resource_account_id, is_read, created_at, savings_deposit_id)
         VALUES ($1, $2, 'SAVINGS', 'Mở tiết kiệm thành công',
                 'Khoản tiết kiệm đã được ghi nhận.', $3, $4, false, $5, $6)`,
        [notificationId, input.customerId, deposit.id, source.id, opening.updatedAt, deposit.id],
      );
      await new OutboxRepository(client).append({
        id: randomUUID(), eventType: "savings.opening_succeeded", aggregateId: openingId,
        deduplicationKey: `savings.opening_succeeded:${openingId}`,
        occurredAt: opening.updatedAt, traceId: input.traceId, subjectCustomerIds: [input.customerId], notificationIds: [notificationId],
        payload: { openingId, depositId: deposit.id, reference },
      });
      await input.fault?.("after_outbox_written");
      await savings.completeIdempotency(input.customerId, "SAVINGS_OPENING", idempotencyKey, { openingId, status: opening.status, responsePayload: openingToPublic(opening) });
      return openingToPublic(opening);
    }, { traceId: input.traceId, maxRetries: 1 });
  }

  async getOpening(customerId: string, openingId: string): Promise<SavingsOpening> {
    assertUuid(openingId, "openingId");
    return this.unitOfWork.transaction(async ({ client }) => {
      const row = await new SavingsRepository(client).findOpening(openingId, customerId);
      if (!row) throw notFound("Savings opening not found.");
      return openingToPublic(row);
    });
  }

  async listDeposits(customerId: string): Promise<SavingsListResult> {
    return this.unitOfWork.transaction(async ({ client }) => {
      const items = (await new SavingsRepository(client).listDeposits(customerId)).map(depositToPublic);
      const total = items.filter((item) => item.status === "ACTIVE").reduce((sum, item) => sum + BigInt(item.principal.amountMinor), 0n);
      return { items, totalPrincipal: toMoney(total) };
    });
  }

  async getDeposit(customerId: string, depositId: string): Promise<SavingsDeposit> {
    assertUuid(depositId, "depositId");
    return this.unitOfWork.transaction(async ({ client }) => {
      const row = await new SavingsRepository(client).findDeposit(customerId, depositId);
      if (!row) throw notFound("Savings deposit not found.");
      return depositToPublic(row);
    });
  }

  async updateMaturityInstruction(
    customerId: string,
    depositId: string,
    instruction: string,
  ): Promise<SavingsDeposit> {
    assertUuid(depositId, "depositId");
    const maturityInstruction = parseInstruction(instruction);
    return this.unitOfWork.transaction(async ({ client }) => {
      const savings = new SavingsRepository(client);
      const deposit = await savings.lockDeposit(depositId);
      if (!deposit || deposit.customerId !== customerId) throw notFound("Savings deposit not found.");
      if (deposit.status !== "ACTIVE") throw conflict("Only ACTIVE savings deposits can update maturity instructions.");
      const updated = await savings.updateDepositMaturityInstruction(depositId, customerId, maturityInstruction);
      await new AuditRepository(client).append({
        id: randomUUID(),
        eventType: "SAVINGS_INSTRUCTION_UPDATED",
        actorCustomerId: customerId,
        resourceId: depositId,
        occurredAt: updated.updatedAt,
        payload: { previousInstruction: deposit.maturityInstruction, nextInstruction: maturityInstruction },
      });
      return depositToPublic(updated);
    });
  }

  async withdrawEarly(input: {
    customerId: string;
    depositId: string;
    idempotencyKey: string;
    traceId?: string;
  }): Promise<SavingsWithdrawalReceipt> {
    assertUuid(input.depositId, "depositId");
    const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
    const requestFingerprint = fingerprint({ depositId: input.depositId, action: "EARLY_WITHDRAWAL" });
    return this.unitOfWork.transaction(async ({ client }) => {
      const savings = new SavingsRepository(client);
      const reservation = await savings.reserveIdempotency({
        id: randomUUID(),
        customerId: input.customerId,
        operationType: "SAVINGS_WITHDRAWAL",
        idempotencyKey,
        requestFingerprint,
      });
      if (!reservation.created) {
        if (String(reservation.record.request_fingerprint) !== requestFingerprint) {
          throw new IdempotencyConflictError();
        }
        if (reservation.record.response_payload && typeof reservation.record.response_payload === "object") {
          return reservation.record.response_payload as SavingsWithdrawalReceipt;
        }
        throw new RelationalConflictError("IDEMPOTENCY_IN_PROGRESS", "The savings withdrawal is still being finalized; retry with the same key.");
      }

      const deposit = await savings.lockDeposit(input.depositId);
      if (!deposit || deposit.customerId !== input.customerId) throw notFound("Savings deposit not found.");
      if (deposit.status !== "ACTIVE") throw conflict("Only ACTIVE savings deposits can be withdrawn.");

      const accounts = new AccountRepository(client);
      const source = await accounts.lockById(deposit.sourceAccountId);
      if (!source || source.customerId !== input.customerId) throw notFound("Source account not found.");
      if (source.status !== "ACTIVE") throw conflict("The source account is not active.");

      const now = new Date().toISOString();
      const calc = calculateEarlyWithdrawal(BigInt(deposit.principalMinor), deposit.openedAt, now);
      const payoutMinor = BigInt(calc.totalPayout.amountMinor);
      const interestMinor = BigInt(calc.earlyInterest.amountMinor);
      const reference = `WTH-${input.depositId.slice(-12).toUpperCase()}`;

      // Cập nhật số dư tài khoản thanh toán nguồn
      const updatedAccount = await accounts.updateBalances(source.id, {
        availableMinor: (BigInt(source.availableMinor) + payoutMinor).toString(),
        currentMinor: (BigInt(source.currentMinor) + payoutMinor).toString(),
        heldMinor: source.heldMinor,
        expectedVersion: source.version,
      });

      // Đóng sổ tiết kiệm
      await savings.closeDepositEarly(deposit.id, input.customerId, calc.earlyInterest.amountMinor, now);

      // Thêm giao dịch tài khoản
      await accounts.appendTransaction({
        id: randomUUID(),
        accountId: source.id,
        savingsOpeningId: deposit.openingId,
        savingsDepositId: deposit.id,
        direction: "CREDIT",
        amountMinor: payoutMinor.toString(),
        feeMinor: "0",
        status: "SUCCEEDED",
        description: `Tất toán trước hạn tiết kiệm ${deposit.productName}`,
        reference,
        occurredAt: now,
        completedAt: now,
        kind: "SAVINGS",
      });

      // Bút toán Sổ cái kép (Double-entry general ledger)
      const journalId = randomUUID();
      await new LedgerRepository(client).appendJournal({
        id: journalId,
        aggregateId: deposit.id,
        journalType: "SAVINGS_EARLY_SETTLEMENT",
        occurredAt: now,
      });
      const ledgerEntries = [
        { lineNumber: 1, accountRef: `savings-deposit:${deposit.id}`, side: "DEBIT" as const, amountMinor: deposit.principalMinor, entryId: randomUUID(), occurredAt: now },
        { lineNumber: 2, accountRef: `payment-account:${updatedAccount.id}`, side: "CREDIT" as const, amountMinor: payoutMinor.toString(), entryId: randomUUID(), occurredAt: now },
      ];
      if (interestMinor > 0n) {
        ledgerEntries.push({
          lineNumber: 3,
          accountRef: "interest-expense:VND",
          side: "DEBIT" as const,
          amountMinor: interestMinor.toString(),
          entryId: randomUUID(),
          occurredAt: now,
        });
      }
      await new LedgerRepository(client).appendEntries(journalId, ledgerEntries);

      // Audit, notifications, outbox
      await new AuditRepository(client).append({
        id: randomUUID(),
        eventType: "SAVINGS_EARLY_WITHDRAWN",
        actorCustomerId: input.customerId,
        resourceId: deposit.id,
        occurredAt: now,
        payload: { traceId: input.traceId ?? null, payoutMinor: payoutMinor.toString(), earlyInterestMinor: interestMinor.toString() },
      });

      const notificationId = randomUUID();
      await client.query(
        `INSERT INTO notifications
          (id, customer_id, notification_type, title, body, resource_id,
           resource_account_id, is_read, created_at, savings_deposit_id)
         VALUES ($1, $2, 'SAVINGS', 'Tất toán tiết kiệm thành công',
                 'Khoản tiết kiệm đã được tất toán trước hạn về tài khoản thanh toán.', $3, $4, false, $5, $6)`,
        [notificationId, input.customerId, deposit.id, source.id, now, deposit.id],
      );

      await new OutboxRepository(client).append({
        id: randomUUID(),
        eventType: "savings.early_withdrawn",
        aggregateId: deposit.id,
        deduplicationKey: `savings.early_withdrawn:${deposit.id}`,
        occurredAt: now,
        traceId: input.traceId,
        subjectCustomerIds: [input.customerId],
        notificationIds: [notificationId],
        payload: { depositId: deposit.id, reference, payoutMinor: payoutMinor.toString() },
      });

      const receipt: SavingsWithdrawalReceipt = {
        depositId: deposit.id,
        sourceAccountId: source.id,
        principal: toMoney(BigInt(deposit.principalMinor)),
        interestDays: calc.interestDays,
        demandRateBasisPoints: calc.demandRateBasisPoints,
        earlyInterest: calc.earlyInterest,
        totalPayout: calc.totalPayout,
        status: "CLOSED",
        reference,
        withdrawnAt: now,
      };

      await savings.completeIdempotency(input.customerId, "SAVINGS_WITHDRAWAL", idempotencyKey, {
        status: "SUCCEEDED",
        responsePayload: receipt,
      });

      return receipt;
    }, { traceId: input.traceId, maxRetries: 1 });
  }
}
