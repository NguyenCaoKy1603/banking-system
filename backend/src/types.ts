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
};

export type LoginResult = LoginResponse | AuthChallengeResponse;

export type PaymentAccount = {
  id: string;
  displayName: string;
  maskedNumber: string;
  currency: Currency;
  availableBalance: Money;
  currentBalance: Money;
  status: "ACTIVE" | "BLOCKED";
  updatedAt: string;
};

export type TransferStatus = "PENDING" | "SUCCEEDED" | "FAILED" | "REVERSED";

export type Transaction = {
  id: string;
  accountId: string;
  direction: "CREDIT" | "DEBIT";
  amount: Money;
  fee: Money;
  status: TransferStatus;
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
  updatedAt: string;
};

export type Notification = {
  id: string;
  type: "TRANSFER" | "SECURITY";
  title: string;
  body: string;
  resourceId: string | null;
  read: boolean;
  createdAt: string;
};

export type FraudReportResponse = {
  reportId: string;
  status: "RECEIVED";
  createdAt: string;
};
