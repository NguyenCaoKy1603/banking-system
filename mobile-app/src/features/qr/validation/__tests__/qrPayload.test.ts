import {
  createReceiveQrPayload,
  parseReceiveQrPayload,
} from "@/features/qr/validation/qrPayload";

describe("receive QR payload", () => {
  it("creates and validates a versioned VND receive payload", () => {
    const raw = createReceiveQrPayload({
      accountNumber: "970400000001",
      displayName: "Nguyễn Văn A",
      maskedAccountNumber: "****1234",
      bankName: "Demo Bank",
    });

    expect(parseReceiveQrPayload(raw)).toMatchObject({
      accountNumber: "970400000001",
      version: 2,
      currency: "VND",
      trust: "UNVERIFIED",
    });
  });

  it("rejects malformed or unsupported payloads", () => {
    expect(() => parseReceiveQrPayload("not-json")).toThrow();
    expect(() =>
      parseReceiveQrPayload(
        JSON.stringify({ version: 1, kind: "PAYMENT", currency: "VND" }),
      ),
    ).toThrow();
    expect(() =>
      createReceiveQrPayload({
        accountNumber: "550e8400-e29b-41d4-a716-446655440000",
        displayName: "Nguyễn Văn A",
        maskedAccountNumber: "****1234",
        bankName: "Demo Bank",
      }),
    ).toThrow();
  });

  it("rejects untrusted beneficiary metadata instead of making it actionable", () => {
    expect(() =>
      parseReceiveQrPayload(
        JSON.stringify({
          version: 2,
          kind: "RECEIVE_MONEY",
          accountNumber: "970400000001",
          displayName: "Nguyễn Văn A",
          maskedAccountNumber: "****1234",
          bankName: "Demo Bank",
          currency: "VND",
          beneficiaryId: "attacker-controlled-beneficiary",
        }),
      ),
    ).toThrow();
  });

  it("rejects oversized and control-character display data", () => {
    expect(() =>
      parseReceiveQrPayload(
        JSON.stringify({
          version: 2,
          kind: "RECEIVE_MONEY",
          accountNumber: "970400000001",
          displayName: "Tên giả\u202e",
          maskedAccountNumber: "****1234",
          bankName: "Demo Bank",
          currency: "VND",
        }),
      ),
    ).toThrow();
    expect(() => parseReceiveQrPayload("x".repeat(4097))).toThrow();
  });
});
