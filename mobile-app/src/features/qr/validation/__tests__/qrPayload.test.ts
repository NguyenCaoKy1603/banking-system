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
    });

    expect(parseReceiveQrPayload(raw)).toMatchObject({
      accountId: "account-1",
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
  });

  it("drops untrusted beneficiary metadata instead of making it actionable", () => {
    const parsed = parseReceiveQrPayload(
      JSON.stringify({
        version: 1,
        kind: "RECEIVE_MONEY",
        accountId: "account-1",
        displayName: "Nguyễn Văn A",
        maskedAccountNumber: "****1234",
        bankName: "Demo Bank",
        currency: "VND",
        beneficiaryId: "attacker-controlled-beneficiary",
      }),
    );

    expect(parsed).not.toHaveProperty("beneficiaryId");
    expect(parsed.trust).toBe("UNVERIFIED");
  });

  it("rejects oversized and control-character display data", () => {
    expect(() =>
      parseReceiveQrPayload(
        JSON.stringify({
          version: 1,
          kind: "RECEIVE_MONEY",
          accountId: "account-1",
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
