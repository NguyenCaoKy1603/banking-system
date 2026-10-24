import type { Money } from "../money.js";

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
  earlyWithdrawnAt?: string | null;
  earlyInterest?: Money | null;
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

export const DEMAND_DEPOSIT_RATE_BASIS_POINTS = 20; // 0.20%/năm lãi suất không kỳ hạn khi rút trước hạn

export type EarlyWithdrawalCalculation = {
  principal: Money;
  interestDays: number;
  demandRateBasisPoints: number;
  earlyInterest: Money;
  totalPayout: Money;
  withdrawnAt: string;
};

export type SavingsWithdrawalReceipt = {
  depositId: string;
  sourceAccountId: string;
  principal: Money;
  interestDays: number;
  demandRateBasisPoints: number;
  earlyInterest: Money;
  totalPayout: Money;
  status: "CLOSED";
  reference: string;
  withdrawnAt: string;
};
