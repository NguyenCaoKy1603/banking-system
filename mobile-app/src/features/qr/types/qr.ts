export const RECEIVE_QR_VERSION = 1 as const;

export type ReceiveQrPayload = {
  version: typeof RECEIVE_QR_VERSION;
  kind: "RECEIVE_MONEY";
  accountId: string;
  displayName: string;
  maskedAccountNumber: string;
  bankName: string;
  currency: "VND";
};

export type UnverifiedReceiveQrData = ReceiveQrPayload & {
  trust: "UNVERIFIED";
};
