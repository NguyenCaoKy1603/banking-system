import {
  RECEIVE_QR_VERSION,
  type ReceiveQrPayload,
  type UnverifiedReceiveQrData,
} from "@/features/qr/types/qr";

type ReceiveQrInput = Omit<ReceiveQrPayload, "version" | "kind" | "currency">;

const MAX_QR_PAYLOAD_LENGTH = 4096;
const MAX_ACCOUNT_ID_LENGTH = 128;
const MAX_DISPLAY_FIELD_LENGTH = 160;
const unsafeDisplayCharacters = /[\u0000-\u001f\u007f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSafeDisplayString(value: unknown, maxLength: number): value is string {
  return (
    isNonEmptyString(value) &&
    value.trim().length <= maxLength &&
    !unsafeDisplayCharacters.test(value)
  );
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
  };

  if (
    !isSafeDisplayString(payload.accountId, MAX_ACCOUNT_ID_LENGTH) ||
    !isSafeDisplayString(payload.displayName, MAX_DISPLAY_FIELD_LENGTH) ||
    !isSafeDisplayString(payload.maskedAccountNumber, MAX_DISPLAY_FIELD_LENGTH) ||
    !isSafeDisplayString(payload.bankName, MAX_DISPLAY_FIELD_LENGTH)
  ) {
    throw new TypeError("QR account fields are invalid.");
  }

  return JSON.stringify(payload);
}

export function parseReceiveQrPayload(raw: string): UnverifiedReceiveQrData {
  if (!raw.trim()) {
    throw new Error("Mã QR đang trống.");
  }

  if (raw.length > MAX_QR_PAYLOAD_LENGTH) {
    throw new Error("Mã QR vượt quá kích thước được hỗ trợ.");
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
    !isSafeDisplayString(parsed.accountId, MAX_ACCOUNT_ID_LENGTH) ||
    !isSafeDisplayString(parsed.displayName, MAX_DISPLAY_FIELD_LENGTH) ||
    !isSafeDisplayString(parsed.maskedAccountNumber, MAX_DISPLAY_FIELD_LENGTH) ||
    !isSafeDisplayString(parsed.bankName, MAX_DISPLAY_FIELD_LENGTH)
  ) {
    throw new Error("Mã QR không đúng payload nhận tiền được hỗ trợ.");
  }

  return {
    version: RECEIVE_QR_VERSION,
    kind: "RECEIVE_MONEY",
    accountId: parsed.accountId.trim(),
    displayName: parsed.displayName.trim(),
    maskedAccountNumber: parsed.maskedAccountNumber.trim(),
    bankName: parsed.bankName.trim(),
    currency: "VND",
    trust: "UNVERIFIED",
  };
}
