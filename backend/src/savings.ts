import type { Money } from "./types.js";

export const SAVINGS_TERM_MONTHS = [1, 3, 6, 12] as const;
export type SavingsTermMonths = (typeof SAVINGS_TERM_MONTHS)[number];

export type MaturityInstruction =
  | "RETURN_PRINCIPAL_AND_INTEREST"
  | "RENEW_PRINCIPAL"
  | "RENEW_PRINCIPAL_AND_INTEREST";

export type SavingsProductStatus = "ACTIVE" | "INACTIVE";

export type SavingsProduct = {
  productId: string;
  name: string;
  termMonths: SavingsTermMonths;
  annualRateBasisPoints: number;
  currency: "VND";
  minAmountMinor: string;
  maxAmountMinor: string;
  status: SavingsProductStatus;
  termsVersion: string;
};

export type SavingsQuote = {
  quoteId: string;
  productId: string;
  productName: string;
  termsVersion: string;
  termMonths: SavingsTermMonths;
  sourceAccountId: string;
  sourceAccountMaskedNumber: string;
  principal: Money;
  annualRateBasisPoints: number;
  interestDays: number;
  expectedInterest: Money;
  totalAtMaturity: Money;
  openedAt: string;
  maturityAt: string;
  maturityInstruction: MaturityInstruction;
  expiresAt: string;
};

export type SavingsOpeningStatus =
  | "PENDING"
  | "SUCCEEDED"
  | "FAILED"
  | "REVERSED";

export type SavingsOpening = {
  openingId: string;
  quoteId: string;
  depositId: string | null;
  status: SavingsOpeningStatus;
  reference: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SavingsDepositStatus = "ACTIVE" | "MATURED" | "CLOSED";

export type SavingsDeposit = {
  depositId: string;
  productId: string;
  productName: string;
  termsVersion: string;
  termMonths: SavingsTermMonths;
  principal: Money;
  annualRateBasisPoints: number;
  expectedInterest: Money;
  totalAtMaturity: Money;
  openedAt: string;
  maturityAt: string;
  maturityInstruction: MaturityInstruction;
  sourceAccountMaskedNumber: string;
  status: SavingsDepositStatus;
  reference: string;
  updatedAt: string;
  renewedDepositId: string | null;
};

export type SavingsQuoteRecord = SavingsQuote & {
  userId: string;
  fingerprint: string;
  consumedOpeningId: string | null;
};

export type SavingsOpeningRecord = SavingsOpening & {
  userId: string;
  idempotencyKey: string;
};

export type SavingsDepositRecord = SavingsDeposit & {
  userId: string;
  sourceAccountId: string;
  openingId: string;
};

export const DEFAULT_SAVINGS_PRODUCTS: readonly SavingsProduct[] = [
  {
    productId: "savings-vnd-1m",
    name: "Tiết kiệm 1 tháng",
    termMonths: 1,
    annualRateBasisPoints: 300,
    currency: "VND",
    minAmountMinor: "1000000",
    maxAmountMinor: "500000000",
    status: "ACTIVE",
    termsVersion: "sandbox-2026-08-v1",
  },
  {
    productId: "savings-vnd-3m",
    name: "Tiết kiệm 3 tháng",
    termMonths: 3,
    annualRateBasisPoints: 350,
    currency: "VND",
    minAmountMinor: "1000000",
    maxAmountMinor: "500000000",
    status: "ACTIVE",
    termsVersion: "sandbox-2026-08-v1",
  },
  {
    productId: "savings-vnd-6m",
    name: "Tiết kiệm 6 tháng",
    termMonths: 6,
    annualRateBasisPoints: 450,
    currency: "VND",
    minAmountMinor: "1000000",
    maxAmountMinor: "500000000",
    status: "ACTIVE",
    termsVersion: "sandbox-2026-08-v1",
  },
  {
    productId: "savings-vnd-12m",
    name: "Tiết kiệm 12 tháng",
    termMonths: 12,
    annualRateBasisPoints: 500,
    currency: "VND",
    minAmountMinor: "1000000",
    maxAmountMinor: "500000000",
    status: "ACTIVE",
    termsVersion: "sandbox-2026-08-v1",
  },
];

const DAY_MS = 24 * 60 * 60 * 1000;
const VIETNAM_TIME_OFFSET_MS = 7 * 60 * 60 * 1000;

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

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

export function calculateActualDays(openedAt: string, maturityAt: string): number {
  const opened = Date.parse(openedAt);
  const maturity = Date.parse(maturityAt);
  if (!Number.isFinite(opened) || !Number.isFinite(maturity) || maturity <= opened) {
    throw new TypeError("Savings dates must be valid and ordered.");
  }
  return Math.max(1, Math.ceil((maturity - opened) / DAY_MS));
}

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

export function cloneSavingsQuote(quote: SavingsQuoteRecord): SavingsQuoteRecord {
  return {
    ...quote,
    principal: { ...quote.principal },
    expectedInterest: { ...quote.expectedInterest },
    totalAtMaturity: { ...quote.totalAtMaturity },
  };
}

export function toPublicSavingsQuote(quote: SavingsQuoteRecord): SavingsQuote {
  const {
    userId: _userId,
    fingerprint: _fingerprint,
    consumedOpeningId: _consumedOpeningId,
    ...publicQuote
  } = cloneSavingsQuote(quote);
  return publicQuote;
}

export function cloneSavingsOpening(
  opening: SavingsOpeningRecord,
): SavingsOpeningRecord {
  return { ...opening };
}

export function toPublicSavingsOpening(opening: SavingsOpeningRecord): SavingsOpening {
  const { userId: _userId, idempotencyKey: _idempotencyKey, ...publicOpening } =
    cloneSavingsOpening(opening);
  return publicOpening;
}

export function cloneSavingsDeposit(
  deposit: SavingsDepositRecord,
): SavingsDepositRecord {
  return {
    ...deposit,
    principal: { ...deposit.principal },
    expectedInterest: { ...deposit.expectedInterest },
    totalAtMaturity: { ...deposit.totalAtMaturity },
  };
}

export function toPublicSavingsDeposit(deposit: SavingsDepositRecord): SavingsDeposit {
  const {
    userId: _userId,
    sourceAccountId: _sourceAccountId,
    openingId: _openingId,
    ...publicDeposit
  } = cloneSavingsDeposit(deposit);
  return publicDeposit;
}
