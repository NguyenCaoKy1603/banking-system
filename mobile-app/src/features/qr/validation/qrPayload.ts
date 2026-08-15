import {
  RECEIVE_QR_VERSION,
  type ReceiveQrPayload,
} from "@/features/qr/types/qr";

type ReceiveQrInput = Omit<ReceiveQrPayload, "version" | "kind" | "currency">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function createReceiveQrPayload(input: ReceiveQrInput): string {
  const payload: ReceiveQrPayload = {
    version: RECEIVE_QR_VERSION,
    kind: "RECEIVE_MONEY",
    accountId: input.accountId.trim(),
    displayName: input.displayName.trim(),
    maskedAccountNumber: input.maskedAccountNumber.trim(),
    bankName: input.bankName.trim(),
    currency: "VND",
    ...(input.beneficiaryId?.trim()
      ? { beneficiaryId: input.beneficiaryId.trim() }
      : {}),
  };

  if (
    !isNonEmptyString(payload.accountId) ||
    !isNonEmptyString(payload.displayName) ||
    !isNonEmptyString(payload.maskedAccountNumber) ||
    !isNonEmptyString(payload.bankName)
  ) {
    throw new TypeError("QR account fields must be non-empty.");
  }

  return JSON.stringify(payload);
}

export function parseReceiveQrPayload(raw: string): ReceiveQrPayload {
  if (!raw.trim()) {
    throw new Error("Mã QR đang trống.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Mã QR không phải JSON hợp lệ.");
  }

  if (
    !isRecord(parsed) ||
    parsed.version !== RECEIVE_QR_VERSION ||
    parsed.kind !== "RECEIVE_MONEY" ||
    parsed.currency !== "VND" ||
    !isNonEmptyString(parsed.accountId) ||
    !isNonEmptyString(parsed.displayName) ||
    !isNonEmptyString(parsed.maskedAccountNumber) ||
    !isNonEmptyString(parsed.bankName) ||
    (parsed.beneficiaryId !== undefined && !isNonEmptyString(parsed.beneficiaryId))
  ) {
    throw new Error("Mã QR không đúng payload nhận tiền được hỗ trợ.");
  }

  return {
    version: RECEIVE_QR_VERSION,
    kind: "RECEIVE_MONEY",
    accountId: parsed.accountId,
    displayName: parsed.displayName,
    maskedAccountNumber: parsed.maskedAccountNumber,
    bankName: parsed.bankName,
    currency: "VND",
    ...(parsed.beneficiaryId ? { beneficiaryId: parsed.beneficiaryId } : {}),
  };
}
