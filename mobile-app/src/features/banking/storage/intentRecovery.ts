export type IntentRecoveryFailureKind = "CORRUPT" | "READ_ERROR";

/**
 * A stored durable command intent cannot be treated as absent when it is
 * malformed or SecureStore is unavailable. The caller must fail closed until
 * the same owner can retry or an operator confirms a safe purge/reconciliation.
 */
export class IntentRecoveryError extends Error {
  readonly kind: IntentRecoveryFailureKind;

  constructor(
    kind: IntentRecoveryFailureKind,
    message =
      "Không thể xác định an toàn trạng thái yêu cầu trước đó trên thiết bị.",
  ) {
    super(message);
    this.name = "IntentRecoveryError";
    this.kind = kind;
  }
}

export function isIntentRecoveryError(
  error: unknown,
): error is IntentRecoveryError {
  return error instanceof IntentRecoveryError;
}
