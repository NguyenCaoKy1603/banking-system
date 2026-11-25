export const RECEIVE_QR_VERSION = 2 as const;

export type QrFormat = "VIETQR" | "INTERNAL_V2";

export type ReceiveQrPayload = {
  version: typeof RECEIVE_QR_VERSION;
  kind: "RECEIVE_MONEY";
  accountNumber: string;
  displayName: string;
  maskedAccountNumber: string;
  bankName: string;
  currency: "VND";
  bankBin?: string;
  amountMinor?: string;
  description?: string;
  format?: QrFormat;
};

export type UnverifiedReceiveQrData = ReceiveQrPayload & {
  trust: "UNVERIFIED";
  format: QrFormat;
  pointOfInitiation?: "11" | "12";
};
