/**
 * Bộ lọc dữ liệu nhạy cảm trước khi chuyển câu hỏi sang Provider.
 * Lưu ý: Regex không thể bảo đảm phát hiện mọi dữ liệu bí mật/PII trong văn bản tự do,
 * nhưng ngăn chặn các dạng phổ biến nhất (private key, card, credential, OTP cụ thể).
 */

const PRIVATE_KEY_PATTERN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i;

// JWT pattern hoặc opaque token dài
const JWT_OR_TOKEN_PATTERN = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/;
const LONG_HEX_TOKEN_PATTERN = /\b[a-f0-9]{32,64}\b/i;

// Số thẻ tín dụng / ghi nợ (16 chữ số, có hoặc không có dấu gạch/khoảng trắng)
const CARD_NUMBER_PATTERN = /\b(?:\d{4}[-\s]?){3}\d{4}\b/;

// Mật khẩu đi kèm giá trị cụ thể (ví dụ: "mật khẩu của tôi là ...", "password: ...", "pass là ...")
const PASSWORD_VALUE_PATTERN = /\b(?:mật\s*khẩu|mat\s*khau|password|pass)(?:\s+(?:của\s+tôi|cua\s+toi|my))?\s*(?:là|la|is|:|=)\s*([^\s]{3,})/i;

// Mã OTP/TOTP 6 chữ số kèm ngữ cảnh người dùng đang cung cấp giá trị
// Ví dụ: "mã otp là 123456", "otp: 654321", "mã totp của tôi là 112233"
// Không chặn câu hỏi khái niệm như "TOTP là gì?", "OTP dùng để làm gì?", "hướng dẫn cài TOTP"
const OTP_VALUE_PATTERN = /\b(?:mã\s*(?:otp|totp)|ma\s*(?:otp|totp)|otp|totp)\s*(?:là|la|is|của tôi là|cua toi la|:|=)\s*(\d{6})\b/i;
const REVERSE_OTP_VALUE_PATTERN = /\b(\d{6})\s+(?:là|la)\s+(?:mã\s*)?(?:otp|totp)\b/i;

export function scanSensitiveData(text: string): boolean {
  if (!text) return false;

  if (PRIVATE_KEY_PATTERN.test(text)) return true;
  if (JWT_OR_TOKEN_PATTERN.test(text)) return true;
  if (CARD_NUMBER_PATTERN.test(text)) return true;
  if (PASSWORD_VALUE_PATTERN.test(text)) return true;
  if (OTP_VALUE_PATTERN.test(text)) return true;
  if (REVERSE_OTP_VALUE_PATTERN.test(text)) return true;

  // Kiểm tra token ngẫu nhiên dạng hex dài
  if (LONG_HEX_TOKEN_PATTERN.test(text)) {
    // Tránh match uuid nếu có gạch nối, ở đây match hex liên tục 32+ ký tự
    return true;
  }

  return false;
}
