import type { Money } from "@/features/banking/types/money";

export type SavingsTermMonths = 1 | 3 | 6 | 12;

export type MaturityInstruction =
  | "RETURN_PRINCIPAL_AND_INTEREST"
  | "RENEW_PRINCIPAL"
  | "RENEW_PRINCIPAL_AND_INTEREST";

export type SavingsProduct = {
  productId: string;
  name: string;
  termMonths: SavingsTermMonths;
  annualRateBasisPoints: number;
  currency: "VND";
  minAmountMinor: string;
  maxAmountMinor: string;
  status: "ACTIVE" | "INACTIVE";
  termsVersion: string;
};

export type SavingsProductsResponse = {
  items: SavingsProduct[];
};

export type SavingsQuoteRequest = {
  sourceAccountId: string;
  productId: string;
  principal: Money;
  maturityInstruction: MaturityInstruction;
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

export type SavingsDepositsResponse = {
  items: SavingsDeposit[];
  totalPrincipal: Money;
};

export type SubmitSavingsOpeningRequest = {
  quoteId: string;
  stepUp: {
    method: "OTP" | "BIOMETRIC";
    proof: string;
    challengeId?: string;
  };
};
