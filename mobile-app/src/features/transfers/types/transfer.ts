import type { Money } from "@/features/banking/types/money";

export type BeneficiaryStatus = "ACTIVE" | "BLOCKED";

export type Beneficiary = {
  id: string;
  displayName: string;
  maskedAccountNumber: string;
  bankName: string;
  status: BeneficiaryStatus;
};

export type BeneficiaryResponse = {
  beneficiary: Beneficiary;
};

export type BeneficiariesResponse = {
  items: Beneficiary[];
};

export type CreateBeneficiaryRequest = {
  displayName: string;
  accountNumber: string;
  bankName: string;
};

export type RenameBeneficiaryRequest = {
  displayName: string;
};

export type TransferQuoteRequest = {
  sourceAccountId: string;
  beneficiaryId: string;
  amount: Money;
};

export type TransferQuote = {
  quoteId: string;
  sourceAccountId: string;
  beneficiary: Beneficiary;
  amount: Money;
  fee: Money;
  totalDebit: Money;
  expiresAt: string;
};

export type StepUpMethod = "OTP" | "BIOMETRIC";

export type SubmitTransferRequest = {
  quoteId: string;
  stepUp: {
    method: StepUpMethod;
    proof: string;
  };
};

export type TransferStatus =
  | "PENDING"
  | "SUCCEEDED"
  | "FAILED"
  | "REVERSED";

export type TransferReceipt = {
  transferId: string;
  reference: string;
  status: TransferStatus;
  amount: Money;
  fee: Money;
  createdAt: string;
  updatedAt: string;
};
