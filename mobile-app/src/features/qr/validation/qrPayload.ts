import {
  RECEIVE_QR_VERSION,
  type ReceiveQrPayload,
  type UnverifiedReceiveQrData,
} from "@/features/qr/types/qr";
import {
  decodeVietQr,
  encodeVietQr,
  DEFAULT_NOVA_BIN,
  type EncodeVietQrInput,
} from "@/features/qr/validation/vietQrCodec";
import { NAPAS_BANKS } from "@/features/transfers/types/transfer";

type ReceiveQrInput = Omit<ReceiveQrPayload, "version" | "kind" | "currency">;

const MAX_QR_PAYLOAD_LENGTH = 4096;
const MAX_DISPLAY_FIELD_LENGTH = 160;
const unsafeDisplayCharacters = /[\u0000-\u001f\u007f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;
const receiveQrKeys = new Set([
  "version",
  "kind",
  "accountNumber",
  "displayName",
  "maskedAccountNumber",
  "bankName",
  "currency",
]);

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

function isAccountNumber(value: unknown): value is string {
  return typeof value === "string" && /^\d{6,34}$/.test(value.trim());
}

function hasOnlyReceiveQrKeys(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value);
  return keys.length === receiveQrKeys.size && keys.every((key) => receiveQrKeys.has(key));
}

function resolveBankNameByBin(bankBin: string): string {
  const found = NAPAS_BANKS.find((b) => b.bin === bankBin);
  if (found) {
    return found.name;
  }
  if (bankBin === DEFAULT_NOVA_BIN) {
    return "Ngân hàng NOVA";
  }
  return `Ngân hàng đối tác (${bankBin})`;
}

/**
 * Creates an internal JSON v2 receive QR payload.
 */
export function createReceiveQrPayload(input: ReceiveQrInput): string {
  const payload: ReceiveQrPayload = {
    version: RECEIVE_QR_VERSION,
    kind: "RECEIVE_MONEY",
    accountNumber: input.accountNumber.trim(),
    displayName: input.displayName.trim(),
    maskedAccountNumber: input.maskedAccountNumber.trim(),
    bankName: input.bankName.trim(),
    currency: "VND",
  };

  if (
    !isAccountNumber(payload.accountNumber) ||
    !isSafeDisplayString(payload.displayName, MAX_DISPLAY_FIELD_LENGTH) ||
    !isSafeDisplayString(payload.maskedAccountNumber, MAX_DISPLAY_FIELD_LENGTH) ||
    !isSafeDisplayString(payload.bankName, MAX_DISPLAY_FIELD_LENGTH)
  ) {
    throw new TypeError("QR account fields are invalid.");
  }

  return JSON.stringify(payload);
}

/**
 * Creates a standard EMVCo NAPAS VietQR payload (supports dynamic QR with prefilled amount & message).
 */
export function createVietQrPayload(input: {
  accountNumber: string;
  bankBin?: string;
  amountMinor?: string;
  message?: string;
  merchantName?: string;
}): string {
  const codecInput: EncodeVietQrInput = {
    bankBin: input.bankBin?.trim() || DEFAULT_NOVA_BIN,
    accountNumber: input.accountNumber.trim(),
    amountMinor: input.amountMinor?.trim(),
    message: input.message?.trim(),
    merchantName: input.merchantName?.trim(),
  };

  return encodeVietQr(codecInput);
}

/**
 * Parses and validates a QR payload:
 * - Detects EMVCo VietQR (`000201...`), verifies CRC-16 checksum and unpacks TLVs.
 * - Otherwise falls back to internal JSON v2 payload validation.
 */
export function parseReceiveQrPayload(raw: string): UnverifiedReceiveQrData {
  if (!raw.trim()) {
    throw new Error("Mã QR đang trống.");
  }

  if (raw.length > MAX_QR_PAYLOAD_LENGTH) {
    throw new Error("Mã QR vượt quá kích thước được hỗ trợ.");
  }

  const trimmed = raw.trim();

  // 1. Detect VietQR (EMVCo Tag 00=01)
  if (trimmed.startsWith("000201")) {
    const decoded = decodeVietQr(trimmed);
    const bankName = resolveBankNameByBin(decoded.bankBin);
    const maskedAccountNumber =
      decoded.accountNumber.length >= 4
        ? `•••• ${decoded.accountNumber.slice(-4)}`
        : decoded.accountNumber;

    const displayName =
      decoded.merchantName?.trim() || `${bankName} (${decoded.accountNumber.slice(-4)})`;

    return {
      version: RECEIVE_QR_VERSION,
      kind: "RECEIVE_MONEY",
      accountNumber: decoded.accountNumber,
      displayName,
      maskedAccountNumber,
      bankName,
      currency: "VND",
      bankBin: decoded.bankBin,
      amountMinor: decoded.amountMinor,
      description: decoded.message,
      format: "VIETQR",
      pointOfInitiation: decoded.pointOfInitiation,
      trust: "UNVERIFIED",
    };
  }

  // 2. Fall back to internal JSON v2
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Mã QR không phải JSON hợp lệ.");
  }

  if (
    !isRecord(parsed) ||
    !hasOnlyReceiveQrKeys(parsed) ||
    parsed.version !== RECEIVE_QR_VERSION ||
    parsed.kind !== "RECEIVE_MONEY" ||
    parsed.currency !== "VND" ||
    !isAccountNumber(parsed.accountNumber) ||
    !isSafeDisplayString(parsed.displayName, MAX_DISPLAY_FIELD_LENGTH) ||
    !isSafeDisplayString(parsed.maskedAccountNumber, MAX_DISPLAY_FIELD_LENGTH) ||
    !isSafeDisplayString(parsed.bankName, MAX_DISPLAY_FIELD_LENGTH)
  ) {
    throw new Error("Mã QR không đúng payload nhận tiền được hỗ trợ.");
  }

  return {
    version: RECEIVE_QR_VERSION,
    kind: "RECEIVE_MONEY",
    accountNumber: parsed.accountNumber.trim(),
    displayName: parsed.displayName.trim(),
    maskedAccountNumber: parsed.maskedAccountNumber.trim(),
    bankName: parsed.bankName.trim(),
    currency: "VND",
    format: "INTERNAL_V2",
    trust: "UNVERIFIED",
  };
}
