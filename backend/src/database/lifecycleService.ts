import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

import { addMonthsClamped, calculateActualDays, calculateSavingsInterest } from "../savings.js";
import { UnitOfWork } from "./unitOfWork.js";
import { AccountRepository } from "./repositories/accountRepository.js";
import { AuditRepository } from "./repositories/auditRepository.js";
import { CreditRepository } from "./repositories/creditRepository.js";
import { LedgerRepository, type LedgerEntryInput } from "./repositories/ledgerRepository.js";
import { OutboxRepository } from "./repositories/outboxRepository.js";
import { SavingsRepository } from "./repositories/savingsRepository.js";
import { RelationalConflictError } from "./commandErrors.js";

export type SavingsMaturityResult = {
  depositId: string;
  status: "MATURED" | "RENEWED" | "ALREADY_PROCESSED";
  renewedDepositId: string | null;
  creditedMinor: string;
  operationKey: string;
};

export type CreditLifecycleSummary = {
  statementsClosed: number;
  statementsOverdue: number;
  paymentsSettled: number;
};

type CreditOperationType = "STATEMENT_CLOSE" | "STATEMENT_OVERDUE" | "PAYMENT_SETTLE" | "PAYMENT_REVERSE";

function iso(value: unknown): string {
  return new Date(String(value)).toISOString();
}

function bigint(value: unknown, field: string): bigint {
  try {
    return BigInt(String(value));
  } catch {
    throw new Error(`Invalid bigint ${field}.`);
  }
}

function addDays(value: string, days: number): string {
  return new Date(Date.parse(value) + days * 24 * 60 * 60 * 1000).toISOString();
}

function previousMonth(value: string): string {
  const date = new Date(value);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString();
}

function nextMonth(value: string): string {
  const date = new Date(value);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString();
}

function minimumPayment(amount: bigint): bigint {
  return amount <= 0n ? 0n : (amount + 19n) / 20n;
}

/**
 * Internal scheduled commands for relational-v2.  The public HTTP boundary
 * deliberately does not expose these methods; the worker/scheduler invokes
 * them with a disposable database during rehearsal and with staging DB later.
 */
export class RelationalLifecycleService {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  async runSavingsMaturities(asOf = new Date().toISOString(), limit = 100): Promise<number> {
    const ids = await this.unitOfWork.transaction(async ({ client }) => {
      const result = await client.query<{ id: string }>(
        `SELECT id FROM savings_deposits
         WHERE status = 'ACTIVE' AND maturity_at <= $1
         ORDER BY maturity_at, id LIMIT $2`,
        [asOf, limit],
      );
      return result.rows.map((row) => row.id);
    });
    let processed = 0;
    for (const id of ids) {
      const result = await this.matureSavingsDeposit(id, asOf);
      if (result.status !== "ALREADY_PROCESSED") processed += 1;
    }
    return processed;
  }

  async matureSavingsDeposit(depositId: string, asOf = new Date().toISOString()): Promise<SavingsMaturityResult> {
    return this.unitOfWork.transaction(async ({ client }) => {
      const savings = new SavingsRepository(client);
      const deposit = await savings.lockDeposit(depositId);
      if (!deposit) throw new RelationalConflictError("SAVINGS_DEPOSIT_NOT_FOUND", "Savings deposit not found.");
      const operationKey = `savings-maturity:${deposit.id}:${deposit.maturityAt}`;
      const operation = await client.query<Record<string, unknown>>(
        `INSERT INTO savings_maturity_operations
           (id, deposit_id, operation_key, status)
         VALUES ($1, $2, $3, 'PENDING')
         ON CONFLICT (deposit_id, operation_key)
         DO UPDATE SET updated_at = NOW()
         RETURNING *`,
        [randomUUID(), deposit.id, operationKey],
      );
      const existing = operation.rows[0];
      if (String(existing?.status) === "SUCCEEDED") {
        const response = (existing?.response_payload ?? {}) as Record<string, unknown>;
        return {
          depositId: deposit.id,
          status: "ALREADY_PROCESSED",
          renewedDepositId: response.renewedDepositId ? String(response.renewedDepositId) : null,
          creditedMinor: String(response.creditedMinor ?? "0"),
          operationKey,
        };
      }
      if (deposit.status !== "ACTIVE") {
        return { depositId: deposit.id, status: "ALREADY_PROCESSED", renewedDepositId: deposit.renewedDepositId, creditedMinor: "0", operationKey };
      }
      if (Date.parse(deposit.maturityAt) > Date.parse(asOf)) {
        throw new RelationalConflictError("SAVINGS_NOT_DUE", "Savings deposit has not reached maturity.");
      }

      const principal = bigint(deposit.principalMinor, "principal_minor");
      const interest = bigint(deposit.expectedInterestMinor, "expected_interest_minor");
      const total = bigint(deposit.totalAtMaturityMinor, "total_at_maturity_minor");
      const renews = deposit.maturityInstruction !== "RETURN_PRINCIPAL_AND_INTEREST";
      const creditedMinor = deposit.maturityInstruction === "RETURN_PRINCIPAL_AND_INTEREST"
        ? total
        : deposit.maturityInstruction === "RENEW_PRINCIPAL"
          ? interest
          : 0n;
      const newPrincipal = !renews
        ? 0n
        : deposit.maturityInstruction === "RENEW_PRINCIPAL"
          ? principal
          : total;

      // Always lock the payment account so a maturity and another account
      // command cannot observe half of the settlement.
      const accounts = new AccountRepository(client);
      const source = await accounts.lockById(deposit.sourceAccountId);
      if (!source || source.customerId !== deposit.customerId || source.status !== "ACTIVE") {
        throw new RelationalConflictError("SAVINGS_ACCOUNT_INVALID", "Savings source account is not active.");
      }
      let updatedSource = source;
      if (creditedMinor > 0n) {
        updatedSource = await accounts.updateBalances(source.id, {
          availableMinor: (BigInt(source.availableMinor) + creditedMinor).toString(),
          currentMinor: (BigInt(source.currentMinor) + creditedMinor).toString(),
          heldMinor: source.heldMinor,
          expectedVersion: source.version,
        });
        const now = new Date().toISOString();
        await accounts.appendTransaction({
          id: randomUUID(),
          accountId: source.id,
          savingsOpeningId: deposit.openingId,
          savingsDepositId: deposit.id,
          direction: "CREDIT",
          amountMinor: creditedMinor.toString(),
          feeMinor: "0",
          status: "SUCCEEDED",
          description: "Tất toán tiền gửi tiết kiệm sandbox",
          reference: `MAT-${deposit.id.slice(-12).toUpperCase()}`,
          occurredAt: now,
          completedAt: now,
          kind: "SAVINGS_MATURITY",
        });
      }

      let renewedDepositId: string | null = null;
      if (renews) {
        const product = await savings.findActiveProduct(deposit.productCode);
        if (!product) throw new RelationalConflictError("SAVINGS_PRODUCT_INACTIVE", "Savings product is no longer active.");
        renewedDepositId = randomUUID();
        const openedAt = deposit.maturityAt;
        const maturityAt = addMonthsClamped(openedAt, product.termMonths);
        const interestDays = calculateActualDays(openedAt, maturityAt);
        const renewedInterest = calculateSavingsInterest(newPrincipal, product.annualRateBasisPoints, interestDays);
        await savings.createDeposit({
          id: renewedDepositId,
          customerId: deposit.customerId,
          openingId: deposit.openingId,
          sourceAccountId: deposit.sourceAccountId,
          productId: product.id,
          principalMinor: newPrincipal.toString(),
          annualRateBasisPoints: product.annualRateBasisPoints,
          expectedInterestMinor: renewedInterest.toString(),
          totalAtMaturityMinor: (newPrincipal + renewedInterest).toString(),
          termMonths: product.termMonths,
          maturityInstruction: deposit.maturityInstruction,
          termsVersion: product.termsVersion,
          reference: `SAV-${renewedDepositId.slice(-12).toUpperCase()}`,
          openedAt,
          maturityAt,
          maturityOperationKey: null,
          renewalSequence: deposit.renewalSequence + 1,
        });
      }

      const terminalStatus = renews ? "CLOSED" : "MATURED";
      await client.query(
        `UPDATE savings_deposits
            SET status = $2, renewed_deposit_id = $3::uuid,
                maturity_operation_key = $4, updated_at = NOW()
          WHERE id = $1 AND status = 'ACTIVE'`,
        [deposit.id, terminalStatus, renewedDepositId, operationKey],
      );

      const now = new Date().toISOString();
      const ledger = new LedgerRepository(client);
      const journalId = randomUUID();
      await ledger.appendJournal({ id: journalId, aggregateId: deposit.id, journalType: "SAVINGS_MATURITY", occurredAt: now });
      const entries: LedgerEntryInput[] = [
        { lineNumber: 1, accountRef: `savings-deposit:${deposit.id}`, side: "DEBIT" as const, amountMinor: total.toString(), entryId: randomUUID(), occurredAt: now },
      ];
      let line = 2;
      if (renewedDepositId) {
        entries.push({ lineNumber: line++, accountRef: `savings-deposit:${renewedDepositId}`, side: "CREDIT" as const, amountMinor: newPrincipal.toString(), entryId: randomUUID(), occurredAt: now });
      }
      if (creditedMinor > 0n) {
        entries.push({ lineNumber: line, accountRef: `payment-account:${updatedSource.id}`, side: "CREDIT" as const, amountMinor: creditedMinor.toString(), entryId: randomUUID(), occurredAt: now });
      }
      await ledger.appendEntries(journalId, entries);
      await new AuditRepository(client).append({
        id: randomUUID(),
        eventType: renews ? "SAVINGS_RENEWED" : "SAVINGS_MATURED",
        actorCustomerId: deposit.customerId,
        resourceId: deposit.id,
        occurredAt: now,
        payload: { operationKey, renewedDepositId, creditedMinor: creditedMinor.toString() },
      });
      const notificationId = randomUUID();
      await client.query(
        `INSERT INTO notifications
          (id, customer_id, notification_type, title, body, resource_id,
           resource_account_id, is_read, created_at, savings_deposit_id)
         VALUES ($1, $2, 'SAVINGS', $3, $4, $5, $6, false, $7, $8)`,
        [notificationId, deposit.customerId, renews ? "Tiền gửi đã được tái tục" : "Tiền gửi đã đáo hạn", renews ? "Khoản tiết kiệm đã được tái tục theo chỉ thị." : "Khoản tiết kiệm đã chuyển tiền về tài khoản thanh toán.", renewedDepositId ?? deposit.id, source.id, now, renewedDepositId ?? deposit.id],
      );
      await new OutboxRepository(client).append({
        id: randomUUID(),
        eventType: renews ? "savings.renewed" : "savings.matured",
        aggregateId: deposit.id,
        occurredAt: now,
        subjectCustomerIds: [deposit.customerId],
        notificationIds: [notificationId],
        payload: { depositId: deposit.id, renewedDepositId, creditedMinor: creditedMinor.toString(), operationKey },
      });
      const responsePayload = { depositId: deposit.id, status: renews ? "RENEWED" : "MATURED", renewedDepositId, creditedMinor: creditedMinor.toString(), operationKey };
      await client.query(
        `UPDATE savings_maturity_operations
            SET status = 'SUCCEEDED', resulting_deposit_id = $2::uuid,
                response_payload = $3::jsonb, updated_at = NOW()
          WHERE deposit_id = $1 AND operation_key = $4`,
        [deposit.id, renewedDepositId, JSON.stringify(responsePayload), operationKey],
      );
      return { depositId: deposit.id, status: renews ? "RENEWED" : "MATURED", renewedDepositId, creditedMinor: creditedMinor.toString(), operationKey };
    }, { maxRetries: 1 });
  }

  async runCreditLifecycle(asOf = new Date().toISOString(), limit = 100): Promise<CreditLifecycleSummary> {
    let statementsClosed = 0;
    let statementsOverdue = 0;
    let paymentsSettled = 0;
    const accountIds = await this.unitOfWork.transaction(async ({ client }) => {
      const result = await client.query<{ id: string }>(
        `SELECT id FROM credit_accounts WHERE status = 'ACTIVE' AND next_statement_at <= $1 ORDER BY next_statement_at, id LIMIT $2`,
        [asOf, limit],
      );
      return result.rows.map((row) => row.id);
    });
    for (const accountId of accountIds) {
      if (await this.closeCreditStatement(accountId, asOf)) statementsClosed += 1;
    }
    const overdueIds = await this.unitOfWork.transaction(async ({ client }) => {
      const result = await client.query<{ id: string }>(
        `SELECT id FROM credit_statements
         WHERE due_at <= $1 AND remaining_amount_due_minor > 0
           AND status IN ('ISSUED', 'PARTIALLY_PAID')
         ORDER BY due_at, id LIMIT $2`,
        [asOf, limit],
      );
      return result.rows.map((row) => row.id);
    });
    for (const statementId of overdueIds) {
      if (await markCreditStatementOverdue(statementId, asOf, this.unitOfWork)) statementsOverdue += 1;
    }
    const paymentIds = await this.unitOfWork.transaction(async ({ client }) => {
      const result = await client.query<{ id: string }>(
        `SELECT id FROM credit_payments WHERE status = 'PENDING' ORDER BY created_at, id LIMIT $1`,
        [limit],
      );
      return result.rows.map((row) => row.id);
    });
    for (const paymentId of paymentIds) {
      if (await this.settlePendingCreditPayment(paymentId, asOf)) paymentsSettled += 1;
    }
    return { statementsClosed, statementsOverdue, paymentsSettled };
  }

  private async closeCreditStatement(accountId: string, asOf: string): Promise<boolean> {
    return this.unitOfWork.transaction(async ({ client }) => {
      const accountResult = await client.query<Record<string, unknown>>("SELECT * FROM credit_accounts WHERE id = $1 FOR UPDATE", [accountId]);
      const account = accountResult.rows[0];
      if (!account || String(account.status) !== "ACTIVE" || Date.parse(iso(account.next_statement_at)) > Date.parse(asOf)) return false;
      const cycleEnd = iso(account.next_statement_at);
      const previous = await client.query<Record<string, unknown>>(
        "SELECT * FROM credit_statements WHERE credit_account_id = $1 ORDER BY cycle_end_at DESC, id DESC LIMIT 1",
        [accountId],
      );
      const previousStatement = previous.rows[0];
      const cycleStart = previousStatement ? iso(previousStatement.cycle_end_at) : previousMonth(cycleEnd);
      const operationKey = `credit-statement-close:${accountId}:${cycleEnd}`;
      const operation = await claimCreditOperation(client, {
        accountId,
        operationType: "STATEMENT_CLOSE",
        operationKey,
      });
      if (String(operation.status) === "SUCCEEDED") return false;
      const transactions = await client.query<Record<string, unknown>>(
        `SELECT id, type, amount_minor, debt_effect FROM credit_transactions
         WHERE credit_account_id = $1 AND statement_id IS NULL AND status = 'POSTED'
           AND posted_at > $2 AND posted_at <= $3
         ORDER BY posted_at, id`,
        [accountId, cycleStart, cycleEnd],
      );
      const opening = previousStatement ? bigint(previousStatement.remaining_amount_due_minor, "opening") : 0n;
      let purchase = 0n; let refund = 0n; let fee = 0n; let interest = 0n;
      for (const transaction of transactions.rows) {
        const amount = bigint(transaction.amount_minor, "transaction_amount");
        const type = String(transaction.type);
        const effect = String(transaction.debt_effect);
        if (type === "PURCHASE" || effect === "INCREASE") purchase += amount;
        else if (type === "REFUND" || effect === "DECREASE") refund += amount;
        else if (type === "FEE") fee += amount;
        else if (type === "INTEREST") interest += amount;
      }
      const closing = opening + purchase + fee + interest - refund;
      const closingPositive = closing > 0n ? closing : 0n;
      const statementId = randomUUID();
      const issuedAt = cycleEnd;
      const dueAt = addDays(cycleEnd, 14);
      const minimum = minimumPayment(closingPositive);
      await client.query(
        `INSERT INTO credit_statements
          (id, credit_account_id, cycle_start_at, cycle_end_at, issued_at, due_at,
           opening_balance_minor, purchase_total_minor, refund_total_minor,
           fee_total_minor, interest_total_minor, closing_balance_minor,
           remaining_amount_due_minor, minimum_payment_due_minor,
           minimum_payment_remaining_minor, paid_amount_minor, status, version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,$13,$13,0,$14,1)`,
        [statementId, accountId, cycleStart, cycleEnd, issuedAt, dueAt, opening.toString(), purchase.toString(), refund.toString(), fee.toString(), interest.toString(), closingPositive.toString(), minimum.toString(), closingPositive > 0n ? "ISSUED" : "PAID"],
      );
      for (const transaction of transactions.rows) {
        await client.query("UPDATE credit_transactions SET statement_id = $2 WHERE id = $1 AND statement_id IS NULL", [transaction.id, statementId]);
        await client.query("INSERT INTO credit_statement_items (statement_id, transaction_id) VALUES ($1, $2)", [statementId, transaction.id]);
      }
      await client.query("UPDATE credit_accounts SET next_statement_at = $2, version = version + 1, updated_at = NOW() WHERE id = $1", [accountId, nextMonth(cycleEnd)]);
      const now = new Date().toISOString();
      await new AuditRepository(client).append({ id: randomUUID(), eventType: "CREDIT_STATEMENT_ISSUED", resourceId: statementId, occurredAt: now, payload: { operationKey, creditAccountId: accountId, closingAmountMinor: closingPositive.toString() } });
      const customerId = String(account.customer_id);
      const notificationId = randomUUID();
      await client.query("INSERT INTO notifications (id, customer_id, notification_type, title, body, resource_id, resource_account_id, is_read, created_at) VALUES ($1,$2,'CREDIT','Sao kê thẻ tín dụng đã phát hành','Sao kê mới đã sẵn sàng trong sandbox.',$3,NULL,false,$4)", [notificationId, customerId, statementId, now]);
      await new OutboxRepository(client).append({ id: randomUUID(), eventType: "credit.statement_issued", aggregateId: statementId, occurredAt: now, subjectCustomerIds: [customerId], notificationIds: [notificationId], payload: { statementId, creditAccountId: accountId, closingAmountMinor: closingPositive.toString(), operationKey } });
      await completeCreditOperation(client, String(operation.id), { statementId, status: "ISSUED", closingAmountMinor: closingPositive.toString() });
      return true;
    }, { maxRetries: 1 });
  }

  private async settlePendingCreditPayment(paymentId: string, occurredAt: string): Promise<boolean> {
    return this.unitOfWork.transaction(async ({ client }) => {
      const paymentResult = await client.query<Record<string, unknown>>("SELECT * FROM credit_payments WHERE id = $1 FOR UPDATE", [paymentId]);
      const payment = paymentResult.rows[0];
      if (!payment || String(payment.status) !== "PENDING") return false;
      const accounts = new AccountRepository(client);
      const source = await accounts.lockById(String(payment.source_account_id));
      const credit = await client.query<Record<string, unknown>>("SELECT * FROM credit_accounts WHERE id = $1 FOR UPDATE", [payment.credit_account_id]);
      const creditRow = credit.rows[0];
      const statement = await client.query<Record<string, unknown>>("SELECT * FROM credit_statements WHERE id = $1 FOR UPDATE", [payment.statement_id]);
      const statementRow = statement.rows[0];
      if (!source || !creditRow || !statementRow) throw new RelationalConflictError("CREDIT_PAYMENT_REFERENCE_INVALID", "Pending credit payment references an invalid aggregate.");
      const operation = await claimCreditOperation(client, { accountId: String(payment.credit_account_id), operationType: "PAYMENT_SETTLE", operationKey: `credit-payment-settle:${String(payment.id)}`, paymentId: String(payment.id), statementId: String(payment.statement_id) });
      if (String(operation.status) === "SUCCEEDED") return false;
      const amount = bigint(payment.amount_minor, "payment_amount");
      if (amount > bigint(source.availableMinor, "available_minor") || amount > bigint(creditRow.posted_outstanding_minor, "posted_outstanding_minor") || amount > bigint(statementRow.remaining_amount_due_minor, "remaining_amount_due_minor")) {
        await client.query("UPDATE credit_payments SET status = 'FAILED', failure_reason = 'OVERPAYMENT_OR_INSUFFICIENT_FUNDS', updated_at = NOW() WHERE id = $1", [payment.id]);
        await new AuditRepository(client).append({ id: randomUUID(), eventType: "CREDIT_PAYMENT_FAILED", actorCustomerId: String(payment.customer_id), resourceId: String(payment.id), occurredAt });
        await new OutboxRepository(client).append({ id: randomUUID(), eventType: "credit.payment_failed", aggregateId: String(payment.id), occurredAt, subjectCustomerIds: [String(payment.customer_id)], payload: { paymentId: String(payment.id), reasonCode: "OVERPAYMENT_OR_INSUFFICIENT_FUNDS" } });
        await completeCreditOperation(client, String(operation.id), { status: "FAILED", paymentId: String(payment.id) });
        return false;
      }
      const updatedSource = await accounts.updateBalances(source.id, { availableMinor: (BigInt(source.availableMinor) - amount).toString(), currentMinor: (BigInt(source.currentMinor) - amount).toString(), heldMinor: source.heldMinor, expectedVersion: source.version });
      await client.query("UPDATE credit_accounts SET posted_outstanding_minor = posted_outstanding_minor - $2, version = version + 1, updated_at = NOW() WHERE id = $1 AND posted_outstanding_minor >= $2 RETURNING id", [creditRow.id, amount.toString()]);
      await client.query("UPDATE credit_payments SET status = 'SUCCEEDED', updated_at = NOW() WHERE id = $1 AND status = 'PENDING'", [payment.id]);
      const updatedStatement = await new CreditRepository(client).updateStatementPayment(String(statementRow.id), amount.toString());
      const now = new Date().toISOString();
      const creditTransactionId = randomUUID();
      await client.query("INSERT INTO credit_transactions (id, credit_account_id, statement_id, credit_payment_id, type, status, description, merchant_name, amount_minor, debt_effect, occurred_at, posted_at) VALUES ($1,$2,$3,$4,'PAYMENT','POSTED','Thanh toán tín dụng sandbox',NULL,$5,'DECREASE',$6,$6)", [creditTransactionId, creditRow.id, statementRow.id, payment.id, amount.toString(), now]);
      await client.query("INSERT INTO credit_statement_items (statement_id, transaction_id) VALUES ($1,$2)", [statementRow.id, creditTransactionId]);
      await accounts.appendTransaction({ id: randomUUID(), accountId: updatedSource.id, creditPaymentId: String(payment.id), direction: "DEBIT", amountMinor: amount.toString(), feeMinor: "0", status: "SUCCEEDED", description: "Thanh toán tín dụng sandbox", reference: String(payment.reference), occurredAt: now, completedAt: now, kind: "CREDIT_PAYMENT" });
      const journalId = randomUUID();
      await new LedgerRepository(client).appendJournal({ id: journalId, aggregateId: String(payment.id), journalType: "CREDIT_PAYMENT", occurredAt: now });
      await new LedgerRepository(client).appendEntries(journalId, [
        { lineNumber: 1, accountRef: `payment-account:${updatedSource.id}`, side: "DEBIT", amountMinor: amount.toString(), entryId: randomUUID(), occurredAt: now },
        { lineNumber: 2, accountRef: `credit-receivable:${creditRow.id}`, side: "CREDIT", amountMinor: amount.toString(), entryId: randomUUID(), occurredAt: now },
      ]);
      await new AuditRepository(client).append({ id: randomUUID(), eventType: "CREDIT_PAYMENT_SUCCEEDED", actorCustomerId: String(payment.customer_id), resourceId: String(payment.id), occurredAt: now, payload: { operationKey: String(operation.operation_key) } });
      const notificationId = randomUUID();
      await client.query("INSERT INTO notifications (id, customer_id, notification_type, title, body, resource_id, resource_account_id, is_read, created_at) VALUES ($1,$2,'CREDIT','Thanh toán tín dụng thành công','Khoản thanh toán đã được ghi nhận.',$3,$4,false,$5)", [notificationId, payment.customer_id, payment.id, updatedSource.id, now]);
      await new OutboxRepository(client).append({ id: randomUUID(), eventType: "credit.payment_succeeded", aggregateId: String(payment.id), occurredAt: now, subjectCustomerIds: [String(payment.customer_id)], notificationIds: [notificationId], payload: { paymentId: String(payment.id), statementId: String(updatedStatement.id), amountMinor: amount.toString(), reference: String(payment.reference) } });
      await completeCreditOperation(client, String(operation.id), { paymentId: String(payment.id), status: "SUCCEEDED", amountMinor: amount.toString() });
      void occurredAt;
      return true;
    }, { maxRetries: 1 });
  }

  async reverseCreditPayment(paymentId: string, asOf = new Date().toISOString()): Promise<boolean> {
    return this.unitOfWork.transaction(async ({ client }) => {
      const paymentResult = await client.query<Record<string, unknown>>("SELECT * FROM credit_payments WHERE id = $1 FOR UPDATE", [paymentId]);
      const payment = paymentResult.rows[0];
      if (!payment) throw new RelationalConflictError("CREDIT_PAYMENT_NOT_FOUND", "Credit payment not found.");
      if (String(payment.status) === "REVERSED") return false;
      if (String(payment.status) !== "SUCCEEDED") throw new RelationalConflictError("CREDIT_PAYMENT_NOT_REVERSIBLE", "Only a succeeded credit payment can be reversed.");
      const accounts = new AccountRepository(client);
      const source = await accounts.lockById(String(payment.source_account_id));
      const credit = await client.query<Record<string, unknown>>("SELECT * FROM credit_accounts WHERE id = $1 FOR UPDATE", [payment.credit_account_id]);
      const statement = await client.query<Record<string, unknown>>("SELECT * FROM credit_statements WHERE id = $1 FOR UPDATE", [payment.statement_id]);
      if (!source || !credit.rows[0] || !statement.rows[0]) throw new RelationalConflictError("CREDIT_PAYMENT_REFERENCE_INVALID", "Credit payment references an invalid aggregate.");
      const operation = await claimCreditOperation(client, { accountId: String(payment.credit_account_id), operationType: "PAYMENT_REVERSE", operationKey: `credit-payment-reverse:${String(payment.id)}`, paymentId: String(payment.id), statementId: String(payment.statement_id) });
      if (String(operation.status) === "SUCCEEDED") return false;
      const amount = bigint(payment.amount_minor, "payment_amount");
      const updatedSource = await accounts.updateBalances(source.id, { availableMinor: (BigInt(source.availableMinor) + amount).toString(), currentMinor: (BigInt(source.currentMinor) + amount).toString(), heldMinor: source.heldMinor, expectedVersion: source.version });
      await client.query("UPDATE credit_accounts SET posted_outstanding_minor = posted_outstanding_minor + $2, version = version + 1, updated_at = NOW() WHERE id = $1", [credit.rows[0].id, amount.toString()]);
      await client.query("UPDATE credit_statements SET remaining_amount_due_minor = remaining_amount_due_minor + $2, minimum_payment_remaining_minor = LEAST(minimum_payment_due_minor, minimum_payment_remaining_minor + $2), paid_amount_minor = GREATEST(0, paid_amount_minor - $2), status = CASE WHEN due_at <= $3 THEN 'OVERDUE' ELSE 'PARTIALLY_PAID' END, version = version + 1 WHERE id = $1", [statement.rows[0].id, amount.toString(), asOf]);
      await client.query("UPDATE credit_payments SET status = 'REVERSED', updated_at = NOW() WHERE id = $1 AND status = 'SUCCEEDED'", [payment.id]);
      const now = new Date().toISOString();
      const reversalTransactionId = randomUUID();
      await client.query("INSERT INTO credit_transactions (id, credit_account_id, statement_id, credit_payment_id, type, status, description, merchant_name, amount_minor, debt_effect, occurred_at, posted_at) VALUES ($1,$2,$3,$4,'ADJUSTMENT','POSTED','Hoàn tác thanh toán tín dụng sandbox',NULL,$5,'INCREASE',$6,$6)", [reversalTransactionId, credit.rows[0].id, statement.rows[0].id, payment.id, amount.toString(), now]);
      await client.query("INSERT INTO credit_statement_items (statement_id, transaction_id) VALUES ($1,$2)", [statement.rows[0].id, reversalTransactionId]);
      await accounts.appendTransaction({ id: randomUUID(), accountId: updatedSource.id, creditPaymentId: String(payment.id), direction: "CREDIT", amountMinor: amount.toString(), feeMinor: "0", status: "SUCCEEDED", description: "Hoàn tác thanh toán tín dụng sandbox", reference: `REV-${String(payment.reference)}`, occurredAt: now, completedAt: now, kind: "CREDIT_PAYMENT_REVERSAL" });
      const journalId = randomUUID();
      await new LedgerRepository(client).appendJournal({ id: journalId, aggregateId: String(payment.id), journalType: "CREDIT_PAYMENT_REVERSAL", occurredAt: now });
      await new LedgerRepository(client).appendEntries(journalId, [
        { lineNumber: 1, accountRef: `credit-receivable:${credit.rows[0].id}`, side: "DEBIT", amountMinor: amount.toString(), entryId: randomUUID(), occurredAt: now },
        { lineNumber: 2, accountRef: `payment-account:${updatedSource.id}`, side: "CREDIT", amountMinor: amount.toString(), entryId: randomUUID(), occurredAt: now },
      ]);
      await new AuditRepository(client).append({ id: randomUUID(), eventType: "CREDIT_PAYMENT_REVERSED", actorCustomerId: String(payment.customer_id), resourceId: String(payment.id), occurredAt: now });
      await new OutboxRepository(client).append({ id: randomUUID(), eventType: "credit.payment_reversed", aggregateId: String(payment.id), occurredAt: now, subjectCustomerIds: [String(payment.customer_id)], payload: { paymentId: String(payment.id), amountMinor: amount.toString(), statementId: String(statement.rows[0].id) } });
      await completeCreditOperation(client, String(operation.id), { paymentId: String(payment.id), status: "SUCCEEDED", amountMinor: amount.toString() });
      return true;
    }, { maxRetries: 1 });
  }
}

async function claimCreditOperation(client: PoolClient, input: { accountId: string; operationType: CreditOperationType; operationKey: string; statementId?: string; paymentId?: string }): Promise<Record<string, unknown>> {
  const result = await client.query<Record<string, unknown>>(
    `INSERT INTO credit_lifecycle_operations
      (id, credit_account_id, operation_type, operation_key, statement_id, payment_id, status)
     VALUES ($1,$2,$3,$4,$5,$6,'PENDING')
     ON CONFLICT (credit_account_id, operation_type, operation_key)
     DO UPDATE SET updated_at = NOW()
     RETURNING *`,
    [randomUUID(), input.accountId, input.operationType, input.operationKey, input.statementId ?? null, input.paymentId ?? null],
  );
  return result.rows[0]!;
}

async function completeCreditOperation(client: PoolClient, operationId: string, response: Record<string, unknown>): Promise<void> {
  await client.query("UPDATE credit_lifecycle_operations SET status = $2, response_payload = $3::jsonb, updated_at = NOW() WHERE id = $1", [operationId, response.status === "FAILED" ? "FAILED" : "SUCCEEDED", JSON.stringify(response)]);
}

async function markCreditStatementOverdue(statementId: string, asOf: string, unitOfWork: UnitOfWork): Promise<boolean> {
  return unitOfWork.transaction(async ({ client }) => {
    const statementResult = await client.query<Record<string, unknown>>("SELECT * FROM credit_statements WHERE id = $1 FOR UPDATE", [statementId]);
    const statement = statementResult.rows[0];
    if (!statement || bigint(statement.remaining_amount_due_minor, "remaining") <= 0n || !["ISSUED", "PARTIALLY_PAID"].includes(String(statement.status)) || Date.parse(iso(statement.due_at)) > Date.parse(asOf)) return false;
    const accountResult = await client.query<Record<string, unknown>>("SELECT * FROM credit_accounts WHERE id = $1 FOR UPDATE", [statement.credit_account_id]);
    const account = accountResult.rows[0];
    if (!account) throw new RelationalConflictError("CREDIT_ACCOUNT_NOT_FOUND", "Credit account not found.");
    const operation = await claimCreditOperation(client, { accountId: String(account.id), operationType: "STATEMENT_OVERDUE", operationKey: `credit-statement-overdue:${String(statement.id)}`, statementId: String(statement.id) });
    if (String(operation.status) === "SUCCEEDED") return false;
    await client.query("UPDATE credit_statements SET status = 'OVERDUE', version = version + 1 WHERE id = $1", [statement.id]);
    const now = new Date().toISOString();
    const customerId = String(account.customer_id);
    const notificationId = randomUUID();
    await client.query("INSERT INTO notifications (id, customer_id, notification_type, title, body, resource_id, resource_account_id, is_read, created_at) VALUES ($1,$2,'CREDIT','Sao kê thẻ đã quá hạn','Sao kê còn nghĩa vụ thanh toán trong sandbox.',$3,NULL,false,$4)", [notificationId, customerId, statement.id, now]);
    await new AuditRepository(client).append({ id: randomUUID(), eventType: "CREDIT_STATEMENT_OVERDUE", actorCustomerId: customerId, resourceId: String(statement.id), occurredAt: now, payload: { operationKey: String(operation.operation_key) } });
    await new OutboxRepository(client).append({ id: randomUUID(), eventType: "credit.statement_overdue", aggregateId: String(statement.id), occurredAt: now, subjectCustomerIds: [customerId], notificationIds: [notificationId], payload: { statementId: String(statement.id), remainingAmountMinor: String(statement.remaining_amount_due_minor) } });
    await completeCreditOperation(client, String(operation.id), { statementId: statement.id, status: "OVERDUE" });
    return true;
  }, { maxRetries: 1 });
}
