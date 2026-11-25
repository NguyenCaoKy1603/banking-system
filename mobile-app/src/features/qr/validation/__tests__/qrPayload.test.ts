import {
  createReceiveQrPayload,
  createVietQrPayload,
  parseReceiveQrPayload,
} from "@/features/qr/validation/qrPayload";
import {
  buildTlv,
  crc16CcittFalse,
  decodeVietQr,
  encodeVietQr,
  parseTlvMap,
  DEFAULT_NOVA_BIN,
} from "@/features/qr/validation/vietQrCodec";

describe("VietQR EMVCo codec & validation", () => {
  it("calculates correct CRC-16/CCITT-FALSE according to reference standard", () => {
    // Standard test vector: "123456789" with Poly 0x1021 and Init 0xFFFF gives 0x29B1
    expect(crc16CcittFalse("123456789")).toBe("29B1");
  });

  it("encodes and decodes a static VietQR payload", () => {
    const raw = createVietQrPayload({
      accountNumber: "1234567890",
      bankBin: "970436", // Vietcombank
      merchantName: "NGUYEN VAN A",
    });

    expect(raw).toMatch(/^000201010211/);
    expect(raw).toContain("38");
    expect(raw).toContain("970436");
    expect(raw).toContain("1234567890");
    expect(raw).toContain("5303704"); // VND
    expect(raw).toContain("5802VN"); // Vietnam
    expect(parseTlvMap(raw).has("54")).toBe(false); // No amount tag in static QR

    const parsed = parseReceiveQrPayload(raw);
    expect(parsed).toMatchObject({
      format: "VIETQR",
      accountNumber: "1234567890",
      bankBin: "970436",
      bankName: "Vietcombank",
      currency: "VND",
      pointOfInitiation: "11",
      trust: "UNVERIFIED",
    });
    expect(parsed.amountMinor).toBeUndefined();
    expect(parsed.description).toBeUndefined();
  });

  it("encodes and decodes a dynamic VietQR with prefilled amount and message", () => {
    const raw = createVietQrPayload({
      accountNumber: "9876543210",
      bankBin: "970422", // MB Bank
      amountMinor: "250000",
      message: "Tien an trua",
      merchantName: "TRAN VAN B",
    });

    expect(raw).toMatch(/^000201010212/); // Tag 01 = 12 (Dynamic)
    expect(raw).toContain("5406250000"); // Tag 54 = 250000
    expect(raw).toContain("Tien an trua"); // Tag 62 with sub-tag 08

    const parsed = parseReceiveQrPayload(raw);
    expect(parsed).toMatchObject({
      format: "VIETQR",
      accountNumber: "9876543210",
      bankBin: "970422",
      bankName: "MB Bank",
      amountMinor: "250000",
      description: "Tien an trua",
      currency: "VND",
      pointOfInitiation: "12",
      trust: "UNVERIFIED",
    });
  });

  it("defaults to NOVA bank BIN when no bankBin is provided", () => {
    const raw = createVietQrPayload({
      accountNumber: "970400123456",
    });

    const parsed = parseReceiveQrPayload(raw);
    expect(parsed.bankBin).toBe(DEFAULT_NOVA_BIN);
    expect(parsed.bankName).toBe("Ngân hàng NOVA");
  });

  it("rejects VietQR with invalid or tampered CRC-16 checksum", () => {
    const valid = createVietQrPayload({
      accountNumber: "1234567890",
      bankBin: "970436",
    });

    // Tamper the last character of CRC
    const tampered = valid.slice(0, -1) + (valid.slice(-1) === "0" ? "1" : "0");
    expect(() => parseReceiveQrPayload(tampered)).toThrow(/CRC-16 không hợp lệ/i);
  });

  it("rejects truncated or malformed VietQR string", () => {
    expect(() => decodeVietQr("000201")).toThrow(/quá ngắn/i);
    expect(() => decodeVietQr("00020101021163040000")).toThrow();
  });

  it("rejects VietQR without Tag 38 or invalid sub-tags", () => {
    // Missing Tag 38
    const invalid = "00020101021153037045802VN6304";
    const crc = crc16CcittFalse(invalid);
    expect(() => decodeVietQr(invalid + crc)).toThrow(/Tag 38/i);
  });

  it("handles Unicode CRC-16, TLV validation errors, and invalid VietQR fields", () => {
    expect(crc16CcittFalse("Tiếng Việt 😀")).toHaveLength(4);
    expect(() => buildTlv("62", "x".repeat(100))).toThrow(/99/);
    expect(() => parseTlvMap("000")).toThrow(/header/i);
    expect(() => parseTlvMap("AA01x")).toThrow(/2 chữ số/i);
    expect(() => parseTlvMap("0005ab")).toThrow(/vượt quá/i);

    expect(() => encodeVietQr({ bankBin: "12", accountNumber: "123456" })).toThrow(/BIN/);
    expect(() => encodeVietQr({ bankBin: "970400", accountNumber: "12" })).toThrow(/Số tài khoản/);

    expect(() => decodeVietQr("990201010211530370463040000")).toThrow(/Tag 00/);
    expect(() => decodeVietQr("00020101021153037045802VN63030000")).toThrow(/Tag 63/);

    const sign = (body: string) => `${body}6304${crc16CcittFalse(`${body}6304`)}`;
    expect(() => decodeVietQr(sign("00020101029938040000"))).toThrow(/Tag 01/);
    expect(() =>
      decodeVietQr(sign(`000201010211${buildTlv("38", buildTlv("00", "A000000727"))}`)),
    ).toThrow(/Tag 38\.01/);
    const badBinTag38 = buildTlv(
      "38",
      buildTlv("00", "A000000727") + buildTlv("01", buildTlv("00", "12") + buildTlv("01", "123456")),
    );
    expect(() => decodeVietQr(sign(`000201010211${badBinTag38}`))).toThrow(/BIN/);
    const badAccTag38 = buildTlv(
      "38",
      buildTlv("00", "A000000727") + buildTlv("01", buildTlv("00", "970400") + buildTlv("01", "12")),
    );
    expect(() => decodeVietQr(sign(`000201010211${badAccTag38}`))).toThrow(/Số tài khoản/i);
  });
});

describe("receive QR payload (Internal JSON v2 backward compatibility)", () => {
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
      format: "INTERNAL_V2",
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
