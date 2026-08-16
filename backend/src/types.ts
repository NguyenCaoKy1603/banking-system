export type Currency = "VND";

export type Money = {
  currency: Currency;
  amountMinor: string;
};

export type AuthUser = {
  id: string;
  fullName: string;
  email: string;
  phoneNumber: string;
  createdAt: string;
};

export type OtpPurpose =
  | "REGISTRATION_VERIFY"
  | "LOGIN"
  | "TRANSFER"
  | "SAVINGS_OPENING"
  | "CREDIT_APPLICATION"
  | "CARD_ACTIVATION"
  | "CREDIT_PAYMENT"
  | "CARD_UNLOCK";

export type LoginResponse = {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  user: AuthUser;
};

export type AuthChallengeResponse = {
  challengeId: string;
  expiresAt: string;
  methods: Array<"OTP" | "BIOMETRIC">;
  purpose?: OtpPurpose;
};

export type LoginResult = LoginResponse | AuthChallengeResponse;

export type PaymentAccount = {
  id: string;
  displayName: string;
  maskedNumber: string;
  bankName: string;
  currency: Currency;
  heldAmount: Money;
  availableBalance: Money;
  currentBalance: Money;
  status: "ACTIVE" | "BLOCKED";
  updatedAt: string;
};

export type FundingReceipt = {
  fundingId: string;
  reference: string;
  status: "SUCCEEDED";
  amount: Money;
  transactionId: string;
  recipientMaskedAccountNumber: string;
  createdAt: string;
};

export type InternalRecipientLookup = {
  lookupId: string;
  accountHolderName: string;
  maskedAccountNumber: string;
  bankName: string;
  status: "ACTIVE" | "BLOCKED";
  expiresAt: string;
};

export type TransactionKind =
  | "TRANSFER"
  | "SANDBOX_FUNDING"
  | "SAVINGS"
  | "CREDIT_PAYMENT"
  | "MATURITY";

export type TransferStatus = "PENDING" | "SUCCEEDED" | "FAILED" | "REVERSED";

export type Transaction = {
  id: string;
  accountId: string;
  direction: "CREDIT" | "DEBIT";
  amount: Money;
  fee: Money;
  status: TransferStatus;
  kind?: TransactionKind;
  description: string;
  counterpartyName: string | null;
  occurredAt: string;
};

export type TransactionDetail = Transaction & {
  reference: string;
  createdAt: string;
  completedAt: string | null;
};

export type Beneficiary = {
  id: string;
  displayName: string;
  accountHolderName?: string;
  maskedAccountNumber: string;
  bankName: string;
  status: "ACTIVE" | "BLOCKED";
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

export type TransferReceipt = {
  transferId: string;
  reference: string;
  status: TransferStatus;
  amount: Money;
  fee: Money;
  createdAt: string;
  updatedAt: string;
};

export type ControlPolicy = {
  configVersion: string;
  globalKillSwitch: boolean;
  transfersEnabled: boolean;
  allowlisted: boolean;
  maxTransferAmountMinor: string;
  stepUpMethods: Array<"OTP" | "BIOMETRIC">;
  savingsEnabled: boolean;
  savingsAllowlisted: boolean;
  maxSavingsAmountMinor: string;
  savingsStepUpMethods: Array<"OTP" | "BIOMETRIC">;
  creditEnabled: boolean;
  creditAllowlisted: boolean;
  creditPaymentsEnabled: boolean;
  cardControlsEnabled: boolean;
  maxCreditPaymentAmountMinor: string;
  creditPaymentStepUpMethods: Array<"OTP" | "BIOMETRIC">;
  cardUnlockStepUpMethods: Array<"OTP" | "BIOMETRIC">;
  updatedAt: string;
};

export type Notification = {
  id: string;
  type: "TRANSFER" | "SAVINGS" | "CREDIT" | "SECURITY";
  title: string;
  body: string;
  resourceId: string | null;
  resourceAccountId: string | null;
  read: boolean;
  createdAt: string;
};

export type FraudReportResponse = {
  reportId: string;
  status: "RECEIVED";
  createdAt: string;
};
