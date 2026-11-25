/**
 * VietQR / EMVCo Merchant Presented Mode QR Codec
 *
 * Implements EMVCo Merchant Presented Mode (TLV) and CRC-16/CCITT-FALSE
 * for NAPAS VietQR standard interoperability.
 */

export const VIETQR_GUID = "A000000727";
export const VIETQR_SERVICE_CODE_ACCOUNT = "QRIBFTTA";
export const VIETQR_CURRENCY_VND = "704";
export const VIETQR_COUNTRY_VN = "VN";
export const DEFAULT_NOVA_BIN = "970400";

export type EncodeVietQrInput = {
  bankBin: string;
  accountNumber: string;
  amountMinor?: string;
  message?: string;
  serviceCode?: string;
  merchantName?: string;
};

export type DecodedVietQr = {
  format: "VIETQR";
  bankBin: string;
  accountNumber: string;
  amountMinor?: string;
  message?: string;
  pointOfInitiation: "11" | "12";
  guid: string;
  serviceCode?: string;
  merchantName?: string;
};

/**
 * Calculates CRC-16/CCITT-FALSE checksum.
 * Polynomial: 0x1021, Initial: 0xFFFF, RefIn: false, RefOut: false, XorOut: 0x0000
 */
export function crc16CcittFalse(data: string): string {
  let crc = 0xffff;
  const bytes: number[] = [];

  for (let i = 0; i < data.length; i++) {
    const code = data.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0xd800 || code >= 0xe000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      i++;
      const nextCode = strCodeAt(data, i);
      const fullCode = 0x10000 + (((code & 0x3ff) << 10) | (nextCode & 0x3ff));
      bytes.push(
        0xf0 | (fullCode >> 18),
        0x80 | ((fullCode >> 12) & 0x3f),
        0x80 | ((fullCode >> 6) & 0x3f),
        0x80 | (fullCode & 0x3f),
      );
    }
  }

  for (let i = 0; i < bytes.length; i++) {
    crc ^= (bytes[i]! << 8);
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }

  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function strCodeAt(str: string, index: number): number {
  return index < str.length ? str.charCodeAt(index) : 0;
}

/**
 * Encodes a Tag-Length-Value (TLV) string.
 * Tag is 2-digit zero padded, Length is 2-digit zero padded, followed by Value.
 */
export function buildTlv(tag: string, value: string): string {
  const normalizedTag = tag.padStart(2, "0");
  const lengthStr = String(value.length).padStart(2, "0");
  if (value.length > 99) {
    throw new Error(`Độ dài giá trị cho tag ${normalizedTag} vượt quá 99 ký tự.`);
  }
  return `${normalizedTag}${lengthStr}${value}`;
}

/**
 * Parses a contiguous TLV string into a Map of tag -> value.
 */
export function parseTlvMap(raw: string): Map<string, string> {
  const result = new Map<string, string>();
  let i = 0;

  while (i < raw.length) {
    if (i + 4 > raw.length) {
      throw new Error("Định dạng TLV không hợp lệ: chuỗi bị ngắt quãng ở header tag/length.");
    }

    const tag = raw.slice(i, i + 2);
    const lengthStr = raw.slice(i + 2, i + 4);

    if (!/^\d{2}$/.test(tag) || !/^\d{2}$/.test(lengthStr)) {
      throw new Error(`Tag hoặc độ dài TLV không đúng 2 chữ số tại vị trí ${i}.`);
    }

    const length = parseInt(lengthStr, 10);
    const valueEnd = i + 4 + length;

    if (valueEnd > raw.length) {
      throw new Error(`Độ dài TLV tag ${tag} (${length}) vượt quá độ dài dữ liệu còn lại.`);
    }

    const value = raw.slice(i + 4, valueEnd);
    result.set(tag, value);
    i = valueEnd;
  }

  return result;
}

/**
 * Encodes bank account details into a NAPAS VietQR (EMVCo) string.
 */
export function encodeVietQr(input: EncodeVietQrInput): string {
  const bankBin = input.bankBin.trim();
  const accountNumber = input.accountNumber.trim();

  if (!/^\d{3,10}$/.test(bankBin)) {
    throw new TypeError("Mã BIN ngân hàng không hợp lệ (cần từ 3 đến 10 chữ số).");
  }

  if (!/^\d{6,34}$/.test(accountNumber)) {
    throw new TypeError("Số tài khoản không hợp lệ (cần từ 6 đến 34 chữ số).");
  }

  const normalizedAmount = input.amountMinor?.trim();
  const hasAmount = Boolean(normalizedAmount && /^[1-9]\d*$/.test(normalizedAmount));
  const poi = hasAmount ? "12" : "11";

  // Tag 00: Payload Format Indicator
  let payload = buildTlv("00", "01");

  // Tag 01: Point of Initiation Method (11: Static, 12: Dynamic)
  payload += buildTlv("01", poi);

  // Tag 38: Consumer Account Information (NAPAS VietQR)
  const sub01 = buildTlv("00", bankBin) + buildTlv("01", accountNumber);
  const tag38Value =
    buildTlv("00", VIETQR_GUID) +
    buildTlv("01", sub01) +
    buildTlv("02", input.serviceCode || VIETQR_SERVICE_CODE_ACCOUNT);
  payload += buildTlv("38", tag38Value);

  // Tag 53: Transaction Currency (VND = 704)
  payload += buildTlv("53", VIETQR_CURRENCY_VND);

  // Tag 54: Transaction Amount (only if specified > 0)
  if (hasAmount && normalizedAmount) {
    payload += buildTlv("54", normalizedAmount);
  }

  // Tag 58: Country Code (VN)
  payload += buildTlv("58", VIETQR_COUNTRY_VN);

  // Tag 59: Merchant Name (optional)
  if (input.merchantName?.trim()) {
    const cleanName = input.merchantName.trim().slice(0, 25);
    payload += buildTlv("59", cleanName);
  }

  // Tag 62: Additional Data Field Template (Message / Description)
  if (input.message?.trim()) {
    const cleanMessage = input.message.trim().slice(0, 50);
    const tag62Value = buildTlv("08", cleanMessage);
    payload += buildTlv("62", tag62Value);
  }

  // Tag 63: CRC-16 Checksum
  const prefixForCrc = `${payload}6304`;
  const crc = crc16CcittFalse(prefixForCrc);

  return `${prefixForCrc}${crc}`;
}

/**
 * Decodes and validates an EMVCo VietQR string.
 */
export function decodeVietQr(raw: string): DecodedVietQr {
  const trimmed = raw.trim();

  if (!trimmed.startsWith("000201")) {
    throw new Error("Mã QR không đúng định dạng EMVCo VietQR (thiếu Tag 00=01).");
  }

  if (trimmed.length < 24) {
    throw new Error("Mã VietQR quá ngắn để chứa dữ liệu hợp lệ.");
  }

  // Check Tag 63 position
  const tag63MarkerIndex = trimmed.lastIndexOf("6304");
  if (tag63MarkerIndex === -1 || tag63MarkerIndex !== trimmed.length - 8) {
    throw new Error("Mã VietQR không hợp lệ: thiếu hoặc sai vị trí trường kiểm tra CRC (Tag 63).");
  }

  const expectedCrc = trimmed.slice(-4).toUpperCase();
  const calculatedCrc = crc16CcittFalse(trimmed.slice(0, -4));

  if (expectedCrc !== calculatedCrc) {
    throw new Error(`Mã VietQR có mã kiểm tra CRC-16 không hợp lệ (nhận ${expectedCrc}, tính được ${calculatedCrc}).`);
  }

  const rootMap = parseTlvMap(trimmed);

  const formatIndicator = rootMap.get("00");
  if (formatIndicator !== "01") {
    throw new Error("Phiên bản định dạng VietQR không được hỗ trợ.");
  }

  const poi = rootMap.get("01") as "11" | "12" | undefined;
  if (poi !== "11" && poi !== "12") {
    throw new Error("Phương thức khởi tạo (Tag 01) không hợp lệ.");
  }

  const tag38Raw = rootMap.get("38");
  if (!tag38Raw) {
    throw new Error("Mã VietQR thiếu thông tin tài khoản thụ hưởng (Tag 38).");
  }

  const tag38Map = parseTlvMap(tag38Raw);
  const guid = tag38Map.get("00") ?? "";

  const sub01Raw = tag38Map.get("01");
  if (!sub01Raw) {
    throw new Error("Mã VietQR thiếu thông tin mạng thanh toán/ngân hàng (Tag 38.01).");
  }

  const sub01Map = parseTlvMap(sub01Raw);
  const bankBin = sub01Map.get("00");
  const accountNumber = sub01Map.get("01");

  if (!bankBin || !/^\d{3,10}$/.test(bankBin)) {
    throw new Error("Mã BIN ngân hàng thụ hưởng trong mã VietQR không hợp lệ.");
  }

  if (!accountNumber || !/^\d{6,34}$/.test(accountNumber)) {
    throw new Error("Số tài khoản thụ hưởng trong mã VietQR không hợp lệ.");
  }

  const serviceCode = tag38Map.get("02");
  const amountMinor = rootMap.get("54");
  const merchantName = rootMap.get("59");

  let message: string | undefined;
  const tag62Raw = rootMap.get("62");
  if (tag62Raw) {
    try {
      const tag62Map = parseTlvMap(tag62Raw);
      message = tag62Map.get("08");
    } catch {
      // Non-blocking parse of additional info
    }
  }

  return {
    format: "VIETQR",
    bankBin,
    accountNumber,
    amountMinor,
    message,
    pointOfInitiation: poi,
    guid,
    serviceCode,
    merchantName,
  };
}
