import type { TransferAnomalyAssessment } from "@/features/anomalies/types/anomaly";
import type { Money } from "@/features/banking/types/money";

export type BeneficiaryStatus = "ACTIVE" | "BLOCKED";

export type Beneficiary = {
  id: string;
  displayName: string;
  accountHolderName?: string;
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
  bankName?: string;
};

export type RenameBeneficiaryRequest = {
  displayName: string;
};

export type TransferQuoteRequest = {
  sourceAccountId: string;
  beneficiaryId?: string;
  lookupId?: string;
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
  anomalyAssessment?: TransferAnomalyAssessment;
};

export type StepUpMethod = "OTP" | "TOTP" | "BIOMETRIC";

export type SubmitTransferRequest = {
  quoteId: string;
  confirmHighRisk?: boolean;
  stepUp: {
    method: StepUpMethod;
    proof: string;
    challengeId?: string;
  };
};

export type TransferRail = "INTERNAL" | "NAPAS_IBFT";

export type NapasBank = {
  bin: string;
  code: string;
  shortName: string;
  name: string;
};

export const NAPAS_BANKS: readonly NapasBank[] = [
  { bin: "970436", code: "VCB", shortName: "VCB", name: "Vietcombank" },
  { bin: "970407", code: "TCB", shortName: "TCB", name: "Techcombank" },
  { bin: "970422", code: "MB", shortName: "MB", name: "MB Bank" },
  { bin: "970423", code: "TPB", shortName: "TPB", name: "TPBank" },
  { bin: "970416", code: "ACB", shortName: "ACB", name: "ACB" },
  { bin: "970418", code: "BIDV", shortName: "BIDV", name: "BIDV" },
  { bin: "970415", code: "CTG", shortName: "VietinBank", name: "VietinBank" },
  { bin: "970405", code: "VBA", shortName: "Agribank", name: "Agribank" },
] as const;

export type ExternalRecipientLookup = {
  lookupId: string;
  rail: "NAPAS_IBFT";
  bankBin: string;
  bankCode: string;
  accountHolderName: string;
  maskedAccountNumber: string;
  bankName: string;
  status: BeneficiaryStatus;
  expiresAt: string;
};

export type ExternalRecipientLookupResponse = {
  recipient: ExternalRecipientLookup;
};

export type InternalRecipientLookup = {
  lookupId: string;
  accountHolderName: string;
  maskedAccountNumber: string;
  bankName: string;
  status: BeneficiaryStatus;
  expiresAt: string;
};

export type InternalRecipientLookupResponse = {
  recipient: InternalRecipientLookup;
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
  anomalyAssessment?: TransferAnomalyAssessment;
};
