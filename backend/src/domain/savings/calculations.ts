import type {
  SavingsProduct,
  SavingsQuote,
  MaturityInstruction,
  EarlyWithdrawalCalculation,
} from "./types.js";
import { DEMAND_DEPOSIT_RATE_BASIS_POINTS } from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const VIETNAM_TIME_OFFSET_MS = 7 * 60 * 60 * 1000;

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * Shifts date forward by specified months using Vietnam banking calendar convention (UTC+07:00).
 */
export function addMonthsClamped(isoDate: string, months: number): string {
  const source = new Date(isoDate);
  if (!Number.isFinite(source.getTime()) || !Number.isInteger(months) || months < 1) {
    throw new TypeError("Invalid date or month term.");
  }

  // Savings terms are defined by the Vietnam banking date, not by the UTC
  // calendar date. Asia/Ho_Chi_Minh is UTC+07:00 and has no daylight-saving
  // transition, so shifting before doing calendar arithmetic preserves both
  // the local day and local time at maturity.
  const localSource = new Date(source.getTime() + VIETNAM_TIME_OFFSET_MS);
  const year = localSource.getUTCFullYear();
  const monthIndex = localSource.getUTCMonth();
  const targetMonthIndex = monthIndex + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const normalizedMonthIndex = targetMonthIndex % 12;
  const targetDay = Math.min(
    localSource.getUTCDate(),
    daysInMonth(targetYear, normalizedMonthIndex),
  );

  return new Date(
    Date.UTC(
      targetYear,
      normalizedMonthIndex,
      targetDay,
      localSource.getUTCHours(),
      localSource.getUTCMinutes(),
      localSource.getUTCSeconds(),
      localSource.getUTCMilliseconds(),
    ) - VIETNAM_TIME_OFFSET_MS,
  ).toISOString();
}

/**
 * Calculates actual days between opening date and maturity/closing date.
 */
export function calculateActualDays(openedAt: string, maturityAt: string): number {
  const opened = Date.parse(openedAt);
  const maturity = Date.parse(maturityAt);
  if (!Number.isFinite(opened) || !Number.isFinite(maturity) || maturity <= opened) {
    throw new TypeError("Savings dates must be valid and ordered.");
  }
  return Math.max(1, Math.ceil((maturity - opened) / DAY_MS));
}

/**
 * Computes standard fixed-term savings interest:
 * Interest = (Principal * annualRateBps * days) / (10,000 * 365)
 */
export function calculateSavingsInterest(
  principalMinor: bigint,
  annualRateBasisPoints: number,
  interestDays: number,
): bigint {
  if (principalMinor <= 0n || annualRateBasisPoints < 0 || interestDays <= 0) {
    throw new RangeError("Savings interest inputs must be positive.");
  }
  return (
    principalMinor * BigInt(annualRateBasisPoints) * BigInt(interestDays)
  ) / (10_000n * 365n);
}

/**
 * Builds a savings quote calculating maturity date, interest days, and projected earnings.
 */
export function buildSavingsQuote(input: {
  quoteId: string;
  product: SavingsProduct;
  sourceAccountId: string;
  sourceAccountMaskedNumber: string;
  principalMinor: bigint;
  openedAt: string;
  maturityInstruction: MaturityInstruction;
  expiresAt: string;
}): SavingsQuote {
  const maturityAt = addMonthsClamped(input.openedAt, input.product.termMonths);
  const interestDays = calculateActualDays(input.openedAt, maturityAt);
  const expectedInterest = calculateSavingsInterest(
    input.principalMinor,
    input.product.annualRateBasisPoints,
    interestDays,
  );

  return {
    quoteId: input.quoteId,
    productId: input.product.productId,
    productName: input.product.name,
    termsVersion: input.product.termsVersion,
    termMonths: input.product.termMonths,
    sourceAccountId: input.sourceAccountId,
    sourceAccountMaskedNumber: input.sourceAccountMaskedNumber,
    principal: { currency: "VND", amountMinor: input.principalMinor.toString() },
    annualRateBasisPoints: input.product.annualRateBasisPoints,
    interestDays,
    expectedInterest: { currency: "VND", amountMinor: expectedInterest.toString() },
    totalAtMaturity: {
      currency: "VND",
      amountMinor: (input.principalMinor + expectedInterest).toString(),
    },
    openedAt: input.openedAt,
    maturityAt,
    maturityInstruction: input.maturityInstruction,
    expiresAt: input.expiresAt,
  };
}

/**
 * Computes early withdrawal interest using demand deposit rate (e.g. 0.20%/year).
 */
export function calculateEarlyWithdrawal(
  principalMinor: bigint,
  openedAt: string,
  withdrawnAt: string,
  demandRateBasisPoints = DEMAND_DEPOSIT_RATE_BASIS_POINTS,
): EarlyWithdrawalCalculation {
  const interestDays = calculateActualDays(openedAt, withdrawnAt);
  const earlyInterestMinor =
    (principalMinor * BigInt(demandRateBasisPoints) * BigInt(interestDays)) /
    (10_000n * 365n);
  const totalPayoutMinor = principalMinor + earlyInterestMinor;
  return {
    principal: { currency: "VND", amountMinor: principalMinor.toString() },
    interestDays,
    demandRateBasisPoints,
    earlyInterest: { currency: "VND", amountMinor: earlyInterestMinor.toString() },
    totalPayout: { currency: "VND", amountMinor: totalPayoutMinor.toString() },
    withdrawnAt,
  };
}
