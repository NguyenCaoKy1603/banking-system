import type { Money } from "../../types.js";

export type AnomalyRuleCode =
  | "HIGH_VALUE_TRANSFER"
  | "LARGE_BALANCE_DRAIN"
  | "NEW_RECIPIENT_HIGH_AMOUNT"
  | "VELOCITY_SPIKE"
  | "RAPID_REPEATED_RECIPIENT"
  | "UNUSUAL_NIGHT_HOUR";

export type AnomalyRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type AnomalyStatus =
  | "OPEN"
  | "CONFIRMED_SAFE"
  | "REPORTED_SUSPICIOUS"
  | "RESOLVED";

export type AnomalyFlag = {
  code: AnomalyRuleCode;
  title: string;
  detail: string;
  weight: number;
};

export type TransferAnomalyAssessment = {
  riskLevel: AnomalyRiskLevel;
  riskScore: number;
  flagged: boolean;
  requiresConfirmation: boolean;
  summary: string;
  flags: AnomalyFlag[];
  evaluatedAt: string;
};

export type TransactionAnomaly = {
  id: string;
  customerId: string;
  accountId: string;
  transferId: string | null;
  transactionId: string | null;
  amount: Money;
  counterpartyName: string | null;
  maskedDestinationAccount: string | null;
  riskLevel: Exclude<AnomalyRiskLevel, "LOW">;
  riskScore: number;
  ruleCodes: AnomalyRuleCode[];
  summary: string;
  flags: AnomalyFlag[];
  status: AnomalyStatus;
  customerNote: string | null;
  acknowledgedAt: string | null;
  resolutionCode: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EvaluateTransferAnomalyInput = {
  amountMinor: bigint;
  feeMinor: bigint;
  availableBalanceMinor: bigint;
  isNewRecipient: boolean;
  recentTransfersLast10mCount: number;
  sameRecipientLast15mCount: number;
  occurredAt: string;
};
