import type {
  ControlPolicy,
  StepUpMethod,
} from "@/features/control/types/controlPolicy";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStepUpMethod(value: unknown): value is StepUpMethod {
  return value === "OTP" || value === "BIOMETRIC";
}

export function isControlPolicy(value: unknown): value is ControlPolicy {
  return (
    isRecord(value) &&
    isNonEmptyString(value.configVersion) &&
    typeof value.globalKillSwitch === "boolean" &&
    typeof value.transfersEnabled === "boolean" &&
    typeof value.allowlisted === "boolean" &&
    typeof value.maxTransferAmountMinor === "string" &&
    /^(0|[1-9][0-9]*)$/.test(value.maxTransferAmountMinor) &&
    Array.isArray(value.stepUpMethods) &&
    value.stepUpMethods.length > 0 &&
    value.stepUpMethods.every(isStepUpMethod) &&
    typeof value.savingsEnabled === "boolean" &&
    typeof value.savingsAllowlisted === "boolean" &&
    typeof value.maxSavingsAmountMinor === "string" &&
    /^(0|[1-9][0-9]*)$/.test(value.maxSavingsAmountMinor) &&
    Array.isArray(value.savingsStepUpMethods) &&
    value.savingsStepUpMethods.length > 0 &&
    value.savingsStepUpMethods.every(isStepUpMethod) &&
    typeof value.creditEnabled === "boolean" &&
    typeof value.creditAllowlisted === "boolean" &&
    typeof value.creditPaymentsEnabled === "boolean" &&
    typeof value.cardControlsEnabled === "boolean" &&
    typeof value.maxCreditPaymentAmountMinor === "string" &&
    /^(0|[1-9][0-9]*)$/.test(value.maxCreditPaymentAmountMinor) &&
    Array.isArray(value.creditPaymentStepUpMethods) &&
    value.creditPaymentStepUpMethods.length > 0 &&
    value.creditPaymentStepUpMethods.every(isStepUpMethod) &&
    Array.isArray(value.cardUnlockStepUpMethods) &&
    value.cardUnlockStepUpMethods.length > 0 &&
    value.cardUnlockStepUpMethods.every(isStepUpMethod) &&
    isNonEmptyString(value.updatedAt)
  );
}
