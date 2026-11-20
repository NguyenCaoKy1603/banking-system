import type {
  AnomaliesListResponse,
  AnomalyDetailResponse,
  AnomalyFlag,
  AnomalyRiskLevel,
  AnomalyRuleCode,
  AnomalyStatus,
  TransactionAnomaly,
  TransferAnomalyAssessment,
} from "@/features/anomalies/types/anomaly";
import { isMoney } from "@/features/banking/validation/moneyValidators";
import { isNonEmptyDateTime } from "@/services/api/responseValidators";

const RULE_CODES = new Set<AnomalyRuleCode>([
  "HIGH_VALUE_TRANSFER",
  "LARGE_BALANCE_DRAIN",
  "NEW_RECIPIENT_HIGH_AMOUNT",
  "VELOCITY_SPIKE",
  "RAPID_REPEATED_RECIPIENT",
  "UNUSUAL_NIGHT_HOUR",
]);

const RISK_LEVELS = new Set<AnomalyRiskLevel>(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
const ANOMALY_STATUSES = new Set<AnomalyStatus>([
  "OPEN",
  "CONFIRMED_SAFE",
  "REPORTED_SUSPICIOUS",
  "RESOLVED",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNullableDateTime(value: unknown): value is string | null {
  return value === null || isNonEmptyDateTime(value);
}

export function isAnomalyFlag(value: unknown): value is AnomalyFlag {
  return (
    isRecord(value) &&
    typeof value.code === "string" &&
    RULE_CODES.has(value.code as AnomalyRuleCode) &&
    isNonEmptyString(value.title) &&
    isNonEmptyString(value.detail) &&
    typeof value.weight === "number" &&
    Number.isFinite(value.weight) &&
    value.weight > 0
  );
}

export function isTransferAnomalyAssessment(
  value: unknown,
): value is TransferAnomalyAssessment {
  return (
    isRecord(value) &&
    typeof value.riskLevel === "string" &&
    RISK_LEVELS.has(value.riskLevel as AnomalyRiskLevel) &&
    typeof value.riskScore === "number" &&
    Number.isFinite(value.riskScore) &&
    value.riskScore >= 0 &&
    value.riskScore <= 100 &&
    typeof value.flagged === "boolean" &&
    typeof value.requiresConfirmation === "boolean" &&
    isNonEmptyString(value.summary) &&
    Array.isArray(value.flags) &&
    value.flags.every((flag) => isAnomalyFlag(flag)) &&
    isNonEmptyDateTime(value.evaluatedAt)
  );
}

export function isTransactionAnomaly(value: unknown): value is TransactionAnomaly {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.customerId) &&
    isNonEmptyString(value.accountId) &&
    isNullableString(value.transferId) &&
    isNullableString(value.transactionId) &&
    isMoney(value.amount) &&
    isNullableString(value.counterpartyName) &&
    isNullableString(value.maskedDestinationAccount) &&
    typeof value.riskLevel === "string" &&
    value.riskLevel !== "LOW" &&
    RISK_LEVELS.has(value.riskLevel as AnomalyRiskLevel) &&
    typeof value.riskScore === "number" &&
    Number.isFinite(value.riskScore) &&
    value.riskScore >= 1 &&
    value.riskScore <= 100 &&
    Array.isArray(value.ruleCodes) &&
    value.ruleCodes.every((code) => typeof code === "string" && RULE_CODES.has(code as AnomalyRuleCode)) &&
    isNonEmptyString(value.summary) &&
    Array.isArray(value.flags) &&
    value.flags.every((flag) => isAnomalyFlag(flag)) &&
    typeof value.status === "string" &&
    ANOMALY_STATUSES.has(value.status as AnomalyStatus) &&
    isNullableString(value.customerNote) &&
    isNullableDateTime(value.acknowledgedAt) &&
    isNullableString(value.resolutionCode) &&
    isNullableDateTime(value.resolvedAt) &&
    isNonEmptyDateTime(value.createdAt) &&
    isNonEmptyDateTime(value.updatedAt)
  );
}

export function isAnomaliesListResponse(
  value: unknown,
): value is AnomaliesListResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.items) &&
    value.items.every((item) => isTransactionAnomaly(item))
  );
}

export function isAnomalyDetailResponse(
  value: unknown,
): value is AnomalyDetailResponse {
  return isRecord(value) && isTransactionAnomaly(value.anomaly);
}
