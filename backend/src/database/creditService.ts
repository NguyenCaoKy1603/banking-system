import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { addDays, calculateAvailableCredit, calculateMinimumPayment, getStatementStatus, nextStatementCloseAt, type CardInstrument, type CreditAccount, type CreditApplication, type CreditApplicationRequest, type CreditCard, type CreditPayment, type CreditPaymentQuote, type CreditPaymentQuoteRequest, type CreditStatement, type CreditTransaction } from "../credit.js";
import { conflict, invalidRequest, notFound } from "../errors.js";
import { fingerprint } from "../security.js";
import { parseMoney, toMoney } from "../money.js";
import { UnitOfWork } from "./unitOfWork.js";
import { AccountRepository } from "./repositories/accountRepository.js";
import { AuditRepository } from "./repositories/auditRepository.js";
import { CreditRepository } from "./repositories/creditRepository.js";
import { LedgerRepository } from "./repositories/ledgerRepository.js";
import { OutboxRepository } from "./repositories/outboxRepository.js";
import { IdempotencyConflictError, RelationalConflictError, RelationalNotFoundError } from "./commandErrors.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_APPLICATION_LIMIT = 100_000_000n;
const DEFAULT_LIMIT = 20_000_000n;

function assertUuid(value: string, field: string): void {
  if (!UUID_PATTERN.test(value)) throw invalidRequest(`${field} is invalid.`, { [field]: `${field} must be a UUID.` });
}

function string(value: unknown, fallback = ""): string { return value === null || value === undefined ? fallback : String(value); }
function int(value: unknown, fallback = 0): number { return value === null || value === undefined ? fallback : Number(value); }
function bigint(value: unknown, field: string): bigint {
  const normalized = typeof value === "bigint" ? value.toString() : String(value);
  if (!/^-?(0|[1-9][0-9]*)$/.test(normalized)) throw new Error(`Database ${field} must be an integer.`);
  return BigInt(normalized);
}
function iso(value: unknown): string {
  const result = new Date(String(value));
  if (Number.isNaN(result.getTime())) throw new Error("Database timestamp is invalid.");
  return result.toISOString();
}
function money(value: unknown) { return { currency: "VND" as const, amountMinor: bigint(value, "money").toString() }; }
function idempotency(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 16 || normalized.length > 128) throw invalidRequest("Idempotency-Key must contain between 16 and 128 characters.");
  return normalized;
}

function applicationPublic(row: Record<string, unknown>): CreditApplication {
  return {
    applicationId: string(row.id),
    requestedLimit: money(row.requested_limit_minor),
    approvedLimit: row.approved_limit_minor === null || row.approved_limit_minor === undefined ? null : money(row.approved_limit_minor),
    status: string(row.status) as CreditApplication["status"],
    decisionReason: row.decision_reason_code === null || row.decision_reason_code === undefined ? null : string(row.decision_reason_code),
    creditAccountId: row.credit_account_id === null || row.credit_account_id === undefined ? null : string(row.credit_account_id),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function accountPublic(row: Record<string, unknown>): CreditAccount {
  const limit = bigint(row.credit_limit_minor, "credit_limit_minor");
  const posted = bigint(row.posted_outstanding_minor, "posted_outstanding_minor");
  const pending = bigint(row.pending_authorizations_minor, "pending_authorizations_minor");
  return {
    creditAccountId: string(row.id),
    currency: "VND",
    creditLimit: toMoney(limit),
    postedOutstanding: toMoney(posted),
    pendingAuthorizations: toMoney(pending),
    availableCredit: toMoney(calculateAvailableCredit(limit, posted, pending)),
    nextStatementAt: iso(row.next_statement_at),
    status: string(row.status) as CreditAccount["status"],
    version: int(row.version),
    updatedAt: iso(row.updated_at),
  };
}

function transactionPublic(row: Record<string, unknown>): CreditTransaction {
  return {
    transactionId: string(row.id),
    creditAccountId: string(row.credit_account_id),
    statementId: row.statement_id === null || row.statement_id === undefined ? null : string(row.statement_id),
    type: string(row.type) as CreditTransaction["type"],
    status: string(row.status) as CreditTransaction["status"],
    description: string(row.description),
    merchantName: row.merchant_name === null || row.merchant_name === undefined ? null : string(row.merchant_name),
    amount: money(row.amount_minor),
    debtEffect: string(row.debt_effect) as CreditTransaction["debtEffect"],
    occurredAt: iso(row.occurred_at),
    postedAt: row.posted_at === null || row.posted_at === undefined ? null : iso(row.posted_at),
  };
}

function paymentPublic(row: Record<string, unknown>): CreditPayment {
  return {
    paymentId: string(row.id),
    statementId: string(row.statement_id),
    sourceAccountId: string(row.source_account_id),
    amount: money(row.amount_minor),
    reference: string(row.reference),
    status: string(row.status) as CreditPayment["status"],
    failureReason: row.failure_reason === null || row.failure_reason === undefined ? null : string(row.failure_reason),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function cursorDecode(cursor: string | undefined, kind: string, scope: string): { sortValue: string; id: string } | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Record<string, unknown>;
    if (parsed.version !== 1 || parsed.kind !== kind || parsed.scope !== scope || typeof parsed.sortValue !== "string" || typeof parsed.id !== "string") throw new Error("invalid cursor");
    return { sortValue: parsed.sortValue, id: parsed.id };
  } catch { throw invalidRequest("cursor is invalid.", { cursor: "cursor is invalid." }); }
}
function cursorEncode(kind: string, scope: string, position: { sortValue: string; id: string }): string {
  return Buffer.from(JSON.stringify({ version: 1, kind, scope, ...position }), "utf8").toString("base64url");
}

function statementPublic(row: Record<string, unknown>, items: CreditTransaction[], payments: CreditPayment[]): CreditStatement {
  return {
    statementId: string(row.id),
    creditAccountId: string(row.credit_account_id),
    cycleStartAt: iso(row.cycle_start_at),
    cycleEndAt: iso(row.cycle_end_at),
    issuedAt: iso(row.issued_at),
    dueAt: iso(row.due_at),
    openingBalance: money(row.opening_balance_minor),
    purchaseTotal: money(row.purchase_total_minor),
    refundTotal: money(row.refund_total_minor),
    feeTotal: money(row.fee_total_minor),
    interestTotal: money(row.interest_total_minor),
    closingBalance: money(row.closing_balance_minor),
    remainingAmountDue: money(row.remaining_amount_due_minor),
    minimumPaymentDue: money(row.minimum_payment_due_minor),
    minimumPaymentRemaining: money(row.minimum_payment_remaining_minor),
    paidAmount: money(row.paid_amount_minor),
    status: string(row.status) as CreditStatement["status"],
    version: int(row.version, 1),
    items,
    payments,
  };
}

function cardPublic(row: Record<string, unknown>, statement: CreditStatement | null): CreditCard {
  const account = accountPublic({
    id: row.credit_account_id,
    currency: row.currency,
    credit_limit_minor: row.credit_limit_minor,
    posted_outstanding_minor: row.posted_outstanding_minor,
    pending_authorizations_minor: row.pending_authorizations_minor,
    next_statement_at: row.next_statement_at,
    status: row.credit_account_status,
    version: row.credit_account_version,
    updated_at: row.credit_account_updated_at,
  });
  return {
    cardId: string(row.id),
    creditAccountId: account.creditAccountId,
    displayName: string(row.display_name),
    brand: string(row.brand) as CardInstrument["brand"],
    maskedNumber: string(row.masked_number),
    lastFour: string(row.last_four),
    expiryMonth: int(row.expiry_month),
    expiryYear: int(row.expiry_year),
    status: string(row.status) as CardInstrument["status"],
    updatedAt: iso(row.updated_at),
    creditLimit: account.creditLimit,
    availableCredit: account.availableCredit,
    postedOutstanding: account.postedOutstanding,
    pendingAuthorizations: account.pendingAuthorizations,
    nextDueAt: statement?.dueAt ?? null,
    remainingAmountDue: statement?.remainingAmountDue ?? toMoney(0n),
    minimumPaymentRemaining: statement?.minimumPaymentRemaining ?? toMoney(0n),
    sandbox: true,
  };
}

export type CreditFaultPoint = "after_quote_consumed" | "after_source_balance" | "after_credit_account" | "after_payment" | "after_ledger" | "after_outbox";

export class RelationalCreditService {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  private async assertAvailable(client: PoolClient, feature: "credit" | "payments" | "cards" = "credit"): Promise<bigint> {
    const result = await client.query<{ global_kill_switch: boolean; credit_enabled: boolean; credit_allowlisted: boolean; credit_payments_enabled: boolean; card_controls_enabled: boolean; max_credit_payment_amount_minor: string }>(
      `SELECT global_kill_switch, credit_enabled, credit_allowlisted,
              credit_payments_enabled, card_controls_enabled,
              max_credit_payment_amount_minor
       FROM control_policy WHERE singleton = true`,
    );
    const row = result.rows[0];
    if (
      row && (
        row.global_kill_switch ||
        !row.credit_enabled ||
        !row.credit_allowlisted ||
        feature === "payments" && !row.credit_payments_enabled ||
        feature === "cards" && !row.card_controls_enabled
      ) || process.env.BANKING_CREDIT_ENABLED === "0"
    ) throw conflict("Credit sandbox is temporarily unavailable.");
    return BigInt(row?.max_credit_payment_amount_minor ?? process.env.BANKING_MAX_CREDIT_PAYMENT_AMOUNT_MINOR ?? DEFAULT_LIMIT.toString());
  }

  private async statement(client: PoolClient, repository: CreditRepository, row: Record<string, unknown>): Promise<CreditStatement> {
    const items = (await repository.listStatementItems(string(row.id))).map(transactionPublic);
    const payments = (await repository.listPaymentsForStatement(string(row.id))).map(paymentPublic);
    return statementPublic(row, items, payments);
  }

  async listCards(customerId: string): Promise<{ items: CreditCard[] }> {
    return this.unitOfWork.transaction(async ({ client }) => {
      await this.assertAvailable(client, "cards");
      const repository = new CreditRepository(client);
      const items: CreditCard[] = [];
      for (const row of await repository.listCards(customerId)) {
        const statements = await repository.listStatements(customerId, string(row.credit_account_id));
        items.push(cardPublic(row, statements[0] ? await this.statement(client, repository, statements[0]) : null));
      }
      return { items };
    });
  }

  async getCard(customerId: string, cardId: string): Promise<{ card: CreditCard; creditAccount: CreditAccount; latestStatement: CreditStatement | null }> {
    assertUuid(cardId, "cardId");
    return this.unitOfWork.transaction(async ({ client }) => {
      await this.assertAvailable(client, "cards");
      const repository = new CreditRepository(client);
      const row = await repository.findCard(customerId, cardId);
      if (!row) throw notFound("Credit card not found.");
      const statements = await repository.listStatements(customerId, string(row.credit_account_id));
      const latest = statements[0] ? await this.statement(client, repository, statements[0]) : null;
      return { card: cardPublic(row, latest), creditAccount: accountPublic({ id: row.credit_account_id, credit_limit_minor: row.credit_limit_minor, posted_outstanding_minor: row.posted_outstanding_minor, pending_authorizations_minor: row.pending_authorizations_minor, next_statement_at: row.next_statement_at, status: row.credit_account_status, version: row.credit_account_version, updated_at: row.credit_account_updated_at }), latestStatement: latest };
    });
  }

  async listApplications(customerId: string): Promise<{ items: CreditApplication[] }> {
    return this.unitOfWork.transaction(async ({ client }) => {
      await this.assertAvailable(client);
      return { items: (await new CreditRepository(client).listApplications(customerId)).map(applicationPublic) };
    });
  }

  async getApplication(customerId: string, applicationId: string): Promise<CreditApplication> {
    assertUuid(applicationId, "applicationId");
    return this.unitOfWork.transaction(async ({ client }) => {
      await this.assertAvailable(client);
      const row = await new CreditRepository(client).findApplication(customerId, applicationId);
      if (!row) throw notFound("Credit application not found.");
      return applicationPublic(row);
    });
  }

  async getApplicationRequestFingerprint(requestedLimit: unknown): Promise<string> {
    const requested = requestedLimit ? parseMoney(requestedLimit, "requestedLimit") : DEFAULT_LIMIT;
    return fingerprint({ requestedLimitMinor: requested.toString() });
  }

  async submitApplication(input: { customerId: string; idempotencyKey: string; request: CreditApplicationRequest; traceId?: string }): Promise<CreditApplication> {
    const key = idempotency(input.idempotencyKey);
    const requested = input.request.requestedLimit ? parseMoney(input.request.requestedLimit, "requestedLimit") : DEFAULT_LIMIT;
    if (requested <= 0n || requested > MAX_APPLICATION_LIMIT) throw conflict("Requested credit limit is outside the sandbox range.");
    const requestFingerprint = fingerprint({ requestedLimitMinor: requested.toString() });
    return this.unitOfWork.transaction(async ({ client }) => {
      await this.assertAvailable(client);
      const repository = new CreditRepository(client);
      const reservation = await repository.reserveIdempotency({ id: randomUUID(), customerId: input.customerId, operationType: "CREDIT_APPLICATION", idempotencyKey: key, requestFingerprint });
      if (!reservation.created) {
        if (string(reservation.record.request_fingerprint) !== requestFingerprint) throw new IdempotencyConflictError();
        if (reservation.record.application_id) {
          const existing = await repository.findApplication(input.customerId, string(reservation.record.application_id));
          if (existing) return applicationPublic(existing);
        }
        throw new RelationalConflictError("IDEMPOTENCY_IN_PROGRESS", "The credit application is still being finalized; retry with the same key.");
      }
      const current = (await repository.listApplications(input.customerId)).find((row) => ["SUBMITTED", "UNDER_REVIEW", "PENDING_ACTIVATION", "ACTIVE"].includes(string(row.status)));
      if (current) {
        if (string(current.request_fingerprint) === requestFingerprint) {
          await repository.completeIdempotency(input.customerId, "CREDIT_APPLICATION", key, { applicationId: string(current.id), status: string(current.status), responsePayload: applicationPublic(current) });
          return applicationPublic(current);
        }
        throw conflict("A credit application already exists for this user.");
      }
      const application = await repository.createApplication({ id: randomUUID(), customerId: input.customerId, requestedLimitMinor: requested.toString(), requestFingerprint });
      await new AuditRepository(client).append({ id: randomUUID(), eventType: "CREDIT_APPLICATION_SUBMITTED", actorCustomerId: input.customerId, resourceId: string(application.id), occurredAt: iso(application.created_at), payload: { traceId: input.traceId ?? null } });
      await new OutboxRepository(client).append({ id: randomUUID(), eventType: "credit.application_submitted", aggregateId: string(application.id), occurredAt: iso(application.created_at), subjectCustomerIds: [input.customerId], payload: { applicationId: string(application.id) }, traceId: input.traceId });
      await repository.completeIdempotency(input.customerId, "CREDIT_APPLICATION", key, { applicationId: string(application.id), status: string(application.status), responsePayload: applicationPublic(application) });
      return applicationPublic(application);
    }, { traceId: input.traceId, maxRetries: 1 });
  }

  async activateApplication(input: { customerId: string; applicationId: string; idempotencyKey: string; traceId?: string }): Promise<CreditApplication> {
    assertUuid(input.applicationId, "applicationId");
    const key = idempotency(input.idempotencyKey);
    const requestFingerprint = fingerprint({ applicationId: input.applicationId });
    return this.unitOfWork.transaction(async ({ client }) => {
      await this.assertAvailable(client);
      const repository = new CreditRepository(client);
      const reservation = await repository.reserveIdempotency({ id: randomUUID(), customerId: input.customerId, operationType: "CREDIT_ACTIVATION", idempotencyKey: key, requestFingerprint });
      if (!reservation.created) {
        if (string(reservation.record.request_fingerprint) !== requestFingerprint) throw new IdempotencyConflictError();
        const existing = reservation.record.application_id ? await repository.findApplication(input.customerId, string(reservation.record.application_id)) : null;
        if (existing) return applicationPublic(existing);
        throw new RelationalConflictError("IDEMPOTENCY_IN_PROGRESS", "The credit activation is still being finalized; retry with the same key.");
      }
      const application = await repository.lockApplication(input.applicationId);
      if (!application || string(application.customer_id) !== input.customerId) throw new RelationalNotFoundError("Credit application not found.");
      if (string(application.status) === "ACTIVE" && application.credit_account_id) {
        const existing = applicationPublic(application);
        await repository.completeIdempotency(input.customerId, "CREDIT_ACTIVATION", key, { applicationId: input.applicationId, status: "ACTIVE", responsePayload: existing });
        return existing;
      }
      if (string(application.status) !== "PENDING_ACTIVATION") throw new RelationalConflictError("APPLICATION_NOT_READY", "Credit application cannot be activated.");
      const approved = bigint(application.approved_limit_minor ?? application.requested_limit_minor, "approved_limit_minor");
      const now = new Date().toISOString();
      const nextStatementAt = nextStatementCloseAt(now);
      const account = await repository.createCreditAccount({ id: randomUUID(), customerId: input.customerId, limitMinor: approved.toString(), nextStatementAt });
      const card = await repository.createCard({ id: randomUUID(), customerId: input.customerId, creditAccountId: string(account.id), now });
      const cycleEnd = nextStatementAt;
      const statement = await repository.createStatement({ id: randomUUID(), creditAccountId: string(account.id), cycleStartAt: now, cycleEndAt: cycleEnd, issuedAt: now, dueAt: addDays(cycleEnd, 15) });
      const activated = await repository.activateApplication({ applicationId: input.applicationId, creditAccountId: string(account.id), approvedLimitMinor: approved.toString() });
      await new AuditRepository(client).append({ id: randomUUID(), eventType: "CREDIT_APPLICATION_ACTIVATED", actorCustomerId: input.customerId, resourceId: input.applicationId, occurredAt: now, payload: { creditAccountId: string(account.id), cardId: string(card.id), statementId: string(statement.id), traceId: input.traceId ?? null } });
      await new OutboxRepository(client).append({ id: randomUUID(), eventType: "credit.application_activated", aggregateId: input.applicationId, occurredAt: now, subjectCustomerIds: [input.customerId], payload: { applicationId: input.applicationId, creditAccountId: string(account.id) }, traceId: input.traceId });
      await repository.completeIdempotency(input.customerId, "CREDIT_ACTIVATION", key, { applicationId: input.applicationId, status: "ACTIVE", responsePayload: applicationPublic(activated) });
      return applicationPublic(activated);
    }, { traceId: input.traceId, maxRetries: 1 });
  }

  async listAccounts(customerId: string): Promise<CreditAccount[]> {
    return this.unitOfWork.transaction(async ({ client }) => { await this.assertAvailable(client); return (await new CreditRepository(client).listCreditAccounts(customerId)).map(accountPublic); });
  }
  async getAccount(customerId: string, accountId: string): Promise<CreditAccount> {
    assertUuid(accountId, "creditAccountId");
    return this.unitOfWork.transaction(async ({ client }) => { await this.assertAvailable(client); const row = await new CreditRepository(client).findCreditAccount(customerId, accountId); if (!row) throw notFound("Credit account not found."); return accountPublic(row); });
  }

  async listTransactions(customerId: string, accountId: string, cursor?: string, limit = 20): Promise<{ items: CreditTransaction[]; nextCursor: string | null }> {
    assertUuid(accountId, "creditAccountId");
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw invalidRequest("limit must be an integer between 1 and 100.");
    return this.unitOfWork.transaction(async ({ client }) => {
      await this.assertAvailable(client);
      const repository = new CreditRepository(client);
      if (!(await repository.findCreditAccount(customerId, accountId))) throw notFound("Credit account not found.");
      const all = (await repository.listTransactions(customerId, accountId)).map(transactionPublic);
      const position = cursorDecode(cursor, "CREDIT_TRANSACTIONS", accountId);
      const remaining = position ? all.filter((item) => item.occurredAt < position.sortValue || item.occurredAt === position.sortValue && item.transactionId < position.id) : all;
      const items = remaining.slice(0, limit); const last = items.at(-1);
      return { items, nextCursor: remaining.length > items.length && last ? cursorEncode("CREDIT_TRANSACTIONS", accountId, { sortValue: last.occurredAt, id: last.transactionId }) : null };
    });
  }

  async listStatements(customerId: string, accountId: string, cursor?: string, limit = 20): Promise<{ items: CreditStatement[]; nextCursor: string | null }> {
    assertUuid(accountId, "creditAccountId");
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw invalidRequest("limit must be an integer between 1 and 100.");
    return this.unitOfWork.transaction(async ({ client }) => {
      await this.assertAvailable(client);
      const repository = new CreditRepository(client);
      if (!(await repository.findCreditAccount(customerId, accountId))) throw notFound("Credit account not found.");
      const all: CreditStatement[] = [];
      for (const row of await repository.listStatements(customerId, accountId)) all.push(await this.statement(client, repository, row));
      const position = cursorDecode(cursor, "CREDIT_STATEMENTS", accountId);
      const remaining = position ? all.filter((item) => item.issuedAt < position.sortValue || item.issuedAt === position.sortValue && item.statementId < position.id) : all;
      const items = remaining.slice(0, limit); const last = items.at(-1);
      return { items, nextCursor: remaining.length > items.length && last ? cursorEncode("CREDIT_STATEMENTS", accountId, { sortValue: last.issuedAt, id: last.statementId }) : null };
    });
  }

  async getStatement(customerId: string, accountId: string, statementId: string): Promise<CreditStatement> {
    assertUuid(accountId, "creditAccountId"); assertUuid(statementId, "statementId");
    return this.unitOfWork.transaction(async ({ client }) => { await this.assertAvailable(client); const repository = new CreditRepository(client); const row = await repository.findStatement(customerId, accountId, statementId); if (!row) throw conflict("Không tìm thấy sao kê tín dụng."); return this.statement(client, repository, row); });
  }

  async createPaymentQuote(customerId: string, input: CreditPaymentQuoteRequest): Promise<CreditPaymentQuote> {
    const sourceAccountId = typeof input.sourceAccountId === "string" ? input.sourceAccountId : "";
    const creditAccountId = typeof input.creditAccountId === "string" ? input.creditAccountId : "";
    const statementId = typeof input.statementId === "string" ? input.statementId : "";
    assertUuid(sourceAccountId, "sourceAccountId"); assertUuid(creditAccountId, "creditAccountId"); assertUuid(statementId, "statementId");
    if (input.paymentOption !== "MINIMUM" && input.paymentOption !== "FULL_STATEMENT" && input.paymentOption !== "CUSTOM") throw invalidRequest("paymentOption is invalid.");
    return this.unitOfWork.transaction(async ({ client }) => {
      const maxPayment = await this.assertAvailable(client, "payments");
      const repository = new CreditRepository(client);
      const source = await new AccountRepository(client).findOwnedAccount(customerId, sourceAccountId);
      if (!source) throw notFound("Account not found.");
      if (source.status !== "ACTIVE") throw conflict("Tài khoản nguồn không hoạt động.");
      const account = await repository.findCreditAccount(customerId, creditAccountId);
      if (!account) throw notFound("Credit account not found.");
      const statement = await repository.findStatement(customerId, creditAccountId, statementId);
      const latest = (await repository.listStatements(customerId, creditAccountId))[0];
      if (!statement || !latest || string(latest.id) !== statementId) throw conflict("Sao kê đã thay đổi; hãy tạo báo giá mới.");
      if (bigint(statement.remaining_amount_due_minor, "remaining") <= 0n) throw conflict("Sao kê này đã được thanh toán đủ.");
      const pending = await client.query("SELECT 1 FROM credit_payments WHERE customer_id = $1 AND credit_account_id = $2 AND status = 'PENDING' LIMIT 1", [customerId, creditAccountId]);
      if (pending.rowCount) throw new RelationalConflictError("PAYMENT_PENDING", "Một khoản thanh toán tín dụng đang được xử lý.");
      const remaining = bigint(statement.remaining_amount_due_minor, "remaining");
      const minimum = bigint(statement.minimum_payment_remaining_minor, "minimum");
      const outstanding = bigint(account.posted_outstanding_minor, "outstanding");
      let amount: bigint;
      if (input.paymentOption === "MINIMUM") amount = minimum;
      else if (input.paymentOption === "FULL_STATEMENT") amount = remaining;
      else { if (!input.amount) throw invalidRequest("amount is required for CUSTOM payment."); amount = parseMoney(input.amount, "amount"); }
      if (amount <= 0n) throw conflict("Số tiền thanh toán phải lớn hơn 0.");
      if (amount > remaining || amount > outstanding) throw new RelationalConflictError("OVERPAYMENT", "Không thể thanh toán vượt dư nợ.");
      if (amount > maxPayment) throw conflict("Số tiền vượt giới hạn sandbox.");
      const card = await repository.findCard(customerId, string((await client.query("SELECT id FROM credit_cards WHERE credit_account_id = $1", [creditAccountId])).rows[0]?.id ?? "00000000-0000-4000-8000-000000000000"));
      if (!card) throw notFound("Credit card not found.");
      const now = new Date().toISOString();
      const quoteId = randomUUID();
      const requestFingerprint = fingerprint({ quoteId });
      const quote = await repository.createPaymentQuote({ id: quoteId, customerId, sourceAccountId, creditAccountId, statementId, statementVersion: String(statement.version), paymentOption: input.paymentOption, amountMinor: amount.toString(), feeMinor: "0", requestFingerprint, expiresAt: new Date(Date.parse(now) + 300_000).toISOString() });
      await new AuditRepository(client).append({ id: randomUUID(), eventType: "CREDIT_PAYMENT_QUOTED", actorCustomerId: customerId, resourceId: string(quote.id), occurredAt: now });
      return {
        quoteId: string(quote.id), sourceAccountId, sourceAccountMaskedNumber: source.maskedNumber,
        creditAccountId, cardLastFour: string(card.last_four), statementId, statementVersion: int(statement.version),
        paymentOption: input.paymentOption, amount: toMoney(amount), fee: toMoney(0n),
        outstandingBefore: toMoney(outstanding), outstandingAfter: toMoney(outstanding - amount),
        minimumPaymentRemainingBefore: toMoney(minimum), minimumPaymentRemainingAfter: toMoney(minimum > amount ? minimum - amount : 0n),
        terms: "Đây là thanh toán tín dụng sandbox; không phải nghĩa vụ tín dụng thật.", expiresAt: iso(quote.expires_at),
      };
    }, { maxRetries: 1 });
  }

  async getPaymentStepUpRequestFingerprint(quoteId: string): Promise<string | null> {
    assertUuid(quoteId, "quoteId");
    return this.unitOfWork.transaction(async ({ client }) => {
      const row = await client.query("SELECT request_fingerprint FROM credit_payment_quotes WHERE id = $1", [quoteId]);
      return row.rows[0] ? string(row.rows[0].request_fingerprint) : null;
    });
  }

  async submitPayment(input: { customerId: string; idempotencyKey: string; quoteId: string; requestFingerprint: string; traceId?: string; fault?: (point: CreditFaultPoint) => void | Promise<void> }): Promise<CreditPayment> {
    const key = idempotency(input.idempotencyKey); assertUuid(input.quoteId, "quoteId");
    return this.unitOfWork.transaction(async ({ client }) => {
      await this.assertAvailable(client, "payments");
      const repository = new CreditRepository(client);
      const reservation = await repository.reserveIdempotency({ id: randomUUID(), customerId: input.customerId, operationType: "CREDIT_PAYMENT", idempotencyKey: key, requestFingerprint: input.requestFingerprint });
      if (!reservation.created) {
        if (string(reservation.record.request_fingerprint) !== input.requestFingerprint) throw new IdempotencyConflictError();
        if (reservation.record.payment_id) {
          const existing = await client.query("SELECT * FROM credit_payments WHERE customer_id = $1 AND id = $2", [input.customerId, reservation.record.payment_id]);
          if (existing.rows[0]) return paymentPublic(existing.rows[0] as Record<string, unknown>);
        }
        throw new RelationalConflictError("IDEMPOTENCY_IN_PROGRESS", "The credit payment is still being finalized; retry with the same key.");
      }
      const quote = await repository.lockPaymentQuote(input.quoteId);
      if (!quote || string(quote.customer_id) !== input.customerId) throw new RelationalNotFoundError("Credit payment quote not found.");
      if (quote.consumed_at) {
        const existing = await repository.findPaymentByIdempotency(input.customerId, key);
        if (existing) return paymentPublic(existing);
        throw new RelationalConflictError("QUOTE_ALREADY_CONSUMED", "Credit payment quote was already consumed.");
      }
      if (Date.parse(iso(quote.expires_at)) <= Date.now()) throw new RelationalConflictError("QUOTE_EXPIRED", "Báo giá thanh toán đã hết hạn.");
      const source = await new AccountRepository(client).lockById(string(quote.source_account_id));
      const credit = await repository.lockCreditAccount(string(quote.credit_account_id));
      const statement = await repository.lockStatement(string(quote.statement_id));
      if (!source || source.customerId !== input.customerId) throw new RelationalNotFoundError("Account not found.");
      if (!credit || string(credit.customer_id) !== input.customerId || string(credit.status) !== "ACTIVE") throw new RelationalConflictError("CREDIT_ACCOUNT_INVALID", "Credit account is not active.");
      if (!statement || string(statement.credit_account_id) !== string(credit.id) || String(statement.version) !== String(quote.statement_version)) throw new RelationalConflictError("STATEMENT_CHANGED", "Sao kê đã thay đổi; hãy tạo báo giá mới.");
      const latest = await client.query("SELECT id FROM credit_statements WHERE credit_account_id = $1 ORDER BY issued_at DESC, id DESC LIMIT 1", [credit.id]);
      if (String(latest.rows[0]?.id) !== String(statement.id)) throw new RelationalConflictError("STATEMENT_SUPERSEDED", "Sao kê không còn hiện hành.");
      const amount = bigint(quote.amount_minor, "amount_minor");
      if (amount > bigint(credit.posted_outstanding_minor, "posted_outstanding_minor") || amount > bigint(statement.remaining_amount_due_minor, "remaining_amount_due_minor")) throw new RelationalConflictError("OVERPAYMENT", "Khoản thanh toán vượt dư nợ hiện tại.");
      if (bigint(source.availableMinor, "availableMinor") < amount) throw new RelationalConflictError("INSUFFICIENT_FUNDS", "Tài khoản nguồn không đủ số dư khả dụng.");
      if (!(await repository.consumePaymentQuote(input.quoteId))) throw new RelationalConflictError("QUOTE_ALREADY_CONSUMED", "Credit payment quote was consumed concurrently.");
      await input.fault?.("after_quote_consumed");
      const updatedSource = await new AccountRepository(client).updateBalances(source.id, { availableMinor: (BigInt(source.availableMinor) - amount).toString(), currentMinor: (BigInt(source.currentMinor) - amount).toString(), heldMinor: source.heldMinor, expectedVersion: source.version });
      await input.fault?.("after_source_balance");
      const updatedCredit = await repository.updateCreditAccount(string(credit.id), { postedOutstandingMinor: (bigint(credit.posted_outstanding_minor, "posted") - amount).toString(), pendingAuthorizationsMinor: string(credit.pending_authorizations_minor), version: string(credit.version) });
      await input.fault?.("after_credit_account");
      const now = new Date().toISOString();
      const paymentId = randomUUID();
      const reference = `CRD-${paymentId.slice(-12).toUpperCase()}`;
      const payment = await repository.createPayment({ id: paymentId, customerId: input.customerId, quoteId: input.quoteId, creditAccountId: string(credit.id), statementId: string(statement.id), sourceAccountId: source.id, idempotencyKey: key, requestFingerprint: input.requestFingerprint, reference, amountMinor: amount.toString() });
      await input.fault?.("after_payment");
      const updatedStatement = await repository.updateStatementPayment(string(statement.id), amount.toString());
      await repository.createTransaction({ id: randomUUID(), creditAccountId: string(credit.id), statementId: string(statement.id), amountMinor: amount.toString(), description: "Thanh toán tín dụng sandbox", occurredAt: now });
      await new AccountRepository(client).appendTransaction({ id: randomUUID(), accountId: source.id, creditPaymentId: paymentId, direction: "DEBIT", amountMinor: amount.toString(), feeMinor: "0", status: "SUCCEEDED", description: "Thanh toán tín dụng sandbox", reference, occurredAt: now, completedAt: now, kind: "CREDIT_PAYMENT" });
      const journalId = randomUUID();
      const ledger = new LedgerRepository(client);
      await ledger.appendJournal({ id: journalId, aggregateId: paymentId, journalType: "CREDIT_PAYMENT", occurredAt: now });
      await ledger.appendEntries(journalId, [
        { lineNumber: 1, accountRef: `payment-account:${updatedSource.id}`, side: "DEBIT", amountMinor: amount.toString(), entryId: randomUUID(), occurredAt: now },
        { lineNumber: 2, accountRef: `credit-receivable:${updatedCredit.id}`, side: "CREDIT", amountMinor: amount.toString(), entryId: randomUUID(), occurredAt: now },
      ]);
      await input.fault?.("after_ledger");
      await new AuditRepository(client).append({ id: randomUUID(), eventType: "CREDIT_PAYMENT_SUCCEEDED", actorCustomerId: input.customerId, resourceId: paymentId, occurredAt: now, payload: { traceId: input.traceId ?? null } });
      const notificationId = randomUUID();
      await client.query("INSERT INTO notifications (id, customer_id, notification_type, title, body, resource_id, resource_account_id, is_read, created_at) VALUES ($1, $2, 'CREDIT', 'Thanh toán tín dụng thành công', 'Khoản thanh toán đã được ghi nhận.', $3, $4, false, $5)", [notificationId, input.customerId, paymentId, source.id, now]);
      await new OutboxRepository(client).append({ id: randomUUID(), eventType: "credit.payment_succeeded", aggregateId: paymentId, deduplicationKey: `credit.payment_succeeded:${paymentId}`, occurredAt: now, traceId: input.traceId, subjectCustomerIds: [input.customerId], notificationIds: [notificationId], payload: { paymentId, statementId: string(updatedStatement.id), amountMinor: amount.toString(), reference } });
      await input.fault?.("after_outbox");
      await repository.completeIdempotency(input.customerId, "CREDIT_PAYMENT", key, { paymentId, status: "SUCCEEDED", responsePayload: paymentPublic(payment) });
      return paymentPublic(payment);
    }, { traceId: input.traceId, maxRetries: 1 });
  }

  async getPayment(customerId: string, paymentId: string): Promise<CreditPayment> {
    assertUuid(paymentId, "paymentId");
    return this.unitOfWork.transaction(async ({ client }) => { await this.assertAvailable(client); const result = await client.query("SELECT * FROM credit_payments WHERE customer_id = $1 AND id = $2", [customerId, paymentId]); if (!result.rows[0]) throw notFound("Credit payment not found."); return paymentPublic(result.rows[0] as Record<string, unknown>); });
  }

  async setCardStatus(customerId: string, cardId: string, status: "ACTIVE" | "LOCKED"): Promise<CreditCard> {
    assertUuid(cardId, "cardId");
    return this.unitOfWork.transaction(async ({ client }) => {
      await this.assertAvailable(client, "cards");
      const repository = new CreditRepository(client); const before = await repository.lockCard(customerId, cardId); if (!before) throw notFound("Credit card not found.");
      if (status === "LOCKED" && ["BLOCKED", "EXPIRED", "CLOSED"].includes(string(before.status))) throw conflict("CARD_STATE_INVALID");
      if (status === "ACTIVE" && string(before.status) !== "LOCKED") throw conflict("CARD_STATE_INVALID");
      const row = await repository.updateCardStatus(customerId, cardId, status); if (!row) throw notFound("Credit card not found.");
      const now = iso(row.updated_at); const eventType = status === "LOCKED" ? "CREDIT_CARD_LOCKED" : "CREDIT_CARD_UNLOCKED";
      await new AuditRepository(client).append({ id: randomUUID(), eventType, actorCustomerId: customerId, resourceId: cardId, occurredAt: now });
      await new OutboxRepository(client).append({ id: randomUUID(), eventType: status === "LOCKED" ? "credit.card_locked" : "credit.card_unlocked", aggregateId: cardId, occurredAt: now, subjectCustomerIds: [customerId], payload: { cardId } });
      const latest = (await repository.listStatements(customerId, string(row.credit_account_id)))[0];
      return cardPublic({ ...row, ...before, status, updated_at: now, credit_account_id: before.credit_account_id }, latest ? await this.statement(client, repository, latest) : null);
    }, { maxRetries: 1 });
  }
}
