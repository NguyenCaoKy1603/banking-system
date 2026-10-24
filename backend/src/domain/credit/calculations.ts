import { randomUUID } from "node:crypto";
import type { Money } from "../money.js";
import {
  CREDIT_MINIMUM_PAYMENT_FLOOR_MINOR,
  CREDIT_MINIMUM_PAYMENT_RATE_PERCENT,
  CREDIT_STATEMENT_CLOSE_DAY,
  type CreditStatementStatus,
} from "./types.js";

export function newCreditId(): string {
  return randomUUID();
}

export function money(amountMinor: bigint): Money {
  if (amountMinor < 0n) {
    throw new RangeError("Credit money cannot be negative.");
  }
  return { currency: "VND", amountMinor: amountMinor.toString() };
}

export function cloneMoney(value: Money): Money {
  return { ...value };
}

export function addDays(isoDate: string, days: number): string {
  const time = Date.parse(isoDate);
  if (!Number.isFinite(time) || !Number.isInteger(days)) {
    throw new Error("Invalid credit date input.");
  }
  return new Date(time + days * 24 * 60 * 60 * 1000).toISOString();
}

export function addMonthsClamped(isoDate: string, months: number): string {
  const source = new Date(isoDate);
  if (!Number.isFinite(source.getTime()) || !Number.isInteger(months)) {
    throw new Error("Invalid credit month input.");
  }
  const day = source.getUTCDate();
  const targetMonth = source.getUTCMonth() + months;
  const targetYear = source.getUTCFullYear() + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      targetYear,
      normalizedMonth,
      Math.min(day, lastDay),
      source.getUTCHours(),
      source.getUTCMinutes(),
      source.getUTCSeconds(),
      source.getUTCMilliseconds(),
    ),
  ).toISOString();
}

/**
 * Returns the next local midnight on the configured statement close day.
 * The sandbox uses Asia/Ho_Chi_Minh, which has a fixed UTC+07:00 offset.
 */
export function nextStatementCloseAt(isoDate: string): string {
  const sourceTime = Date.parse(isoDate);
  if (!Number.isFinite(sourceTime)) {
    throw new Error("Invalid credit statement date input.");
  }

  const localTime = new Date(sourceTime + 7 * 60 * 60 * 1000);
  const year = localTime.getUTCFullYear();
  const month = localTime.getUTCMonth();
  const toUtcClose = (targetYear: number, targetMonth: number): number =>
    Date.UTC(targetYear, targetMonth, CREDIT_STATEMENT_CLOSE_DAY, 0, 0, 0, 0) -
    7 * 60 * 60 * 1000;

  let closeAt = toUtcClose(year, month);
  if (closeAt <= sourceTime) {
    closeAt = toUtcClose(year, month + 1);
  }
  return new Date(closeAt).toISOString();
}

export function calculateMinimumPayment(closingBalanceMinor: bigint): bigint {
  if (closingBalanceMinor <= 0n) {
    return 0n;
  }
  const percentage = (closingBalanceMinor * CREDIT_MINIMUM_PAYMENT_RATE_PERCENT + 99n) / 100n;
  const calculatedMinimum = percentage > CREDIT_MINIMUM_PAYMENT_FLOOR_MINOR
    ? percentage
    : CREDIT_MINIMUM_PAYMENT_FLOOR_MINOR;
  return calculatedMinimum < closingBalanceMinor ? calculatedMinimum : closingBalanceMinor;
}

export function calculateAvailableCredit(
  creditLimitMinor: bigint,
  postedOutstandingMinor: bigint,
  pendingAuthorizationsMinor: bigint,
): bigint {
  return creditLimitMinor - postedOutstandingMinor - pendingAuthorizationsMinor;
}

export function getStatementStatus(
  remainingAmountDueMinor: bigint,
  minimumPaymentRemainingMinor: bigint,
  paidAmountMinor: bigint,
  dueAt: string,
  now: number,
): CreditStatementStatus {
  if (remainingAmountDueMinor <= 0n) {
    return "PAID";
  }
  if (Date.parse(dueAt) <= now && minimumPaymentRemainingMinor > 0n) {
    return "OVERDUE";
  }
  if (paidAmountMinor > 0n) {
    return "PARTIALLY_PAID";
  }
  return "ISSUED";
}
