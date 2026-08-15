import {
  createReceiveQrPayload,
  parseReceiveQrPayload,
} from "@/features/qr/validation/qrPayload";

describe("receive QR payload", () => {
  it("creates and validates a versioned VND receive payload", () => {
    const raw = createReceiveQrPayload({
      accountId: "account-1",
      displayName: "Nguyễn Văn A",
      maskedAccountNumber: "****1234",
      bankName: "Demo Bank",
      beneficiaryId: "beneficiary-1",
    });

    expect(parseReceiveQrPayload(raw)).toMatchObject({
      accountId: "account-1",
      beneficiaryId: "beneficiary-1",
      currency: "VND",
    });
  });

  it("rejects malformed or unsupported payloads", () => {
    expect(() => parseReceiveQrPayload("not-json")).toThrow();
    expect(() =>
      parseReceiveQrPayload(
        JSON.stringify({ version: 1, kind: "PAYMENT", currency: "VND" }),
      ),
    ).toThrow();
  });
});
