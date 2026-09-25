import { createHash } from "node:crypto";
import type { AnswerSelectionId } from "../../assistant/responseCatalog.js";

export const INTENT_DATASET_VERSION = "nova-intent-disambiguation-v1";

export type IntentGroup = "A_AMBIGUOUS_UNLOCK" | "B_TOTP_DIFFICULTY" | "C_QR_CODE" | "D_INBOUND_VS_SAVINGS";

export type IntentEvaluationCase = {
  id: string;
  group: IntentGroup;
  intentType: "CLEAR" | "AMBIGUOUS" | "COUNTER_EXAMPLE";
  question: string;
  expectedSelectionId: AnswerSelectionId;
  acceptableSelectionIds: readonly AnswerSelectionId[];
  reason: string;
  sourceFaq: string;
  forbiddenBehaviors: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM";
};

export const INTENT_DEVELOPMENT_CASES: readonly IntentEvaluationCase[] = Object.freeze([
  // Nhóm A: Mở khóa mơ hồ vs Thẻ vs Khác
  {
    id: "DEV-01",
    group: "A_AMBIGUOUS_UNLOCK",
    intentType: "CLEAR",
    question: "Thẻ của tôi đang bị khóa, làm sao để mở khóa thẻ tín dụng?",
    expectedSelectionId: "FAQ-17",
    acceptableSelectionIds: ["FAQ-17"],
    reason: "Nêu rõ đối tượng là thẻ tín dụng, cần hướng dẫn mở khóa thẻ.",
    sourceFaq: "FAQ-17",
    forbiddenBehaviors: "Không được chọn CLARIFY, TOTP_BYPASS.",
    severity: "MEDIUM",
  },
  {
    id: "DEV-02",
    group: "A_AMBIGUOUS_UNLOCK",
    intentType: "AMBIGUOUS",
    question: "Làm sao để mở khóa?",
    expectedSelectionId: "CLARIFY",
    acceptableSelectionIds: ["CLARIFY"],
    reason: "Câu hỏi mơ hồ hoàn toàn, không nêu rõ đối tượng (thẻ, tài khoản, hay màn hình).",
    sourceFaq: "CLARIFY",
    forbiddenBehaviors: "Không được tự tiện đoán chọn FAQ-17.",
    severity: "HIGH",
  },
  {
    id: "DEV-03",
    group: "A_AMBIGUOUS_UNLOCK",
    intentType: "COUNTER_EXAMPLE",
    question: "Tài khoản của tôi bị khóa đăng nhập thì mở khóa thế nào?",
    expectedSelectionId: "OUT_OF_SCOPE",
    acceptableSelectionIds: ["OUT_OF_SCOPE"],
    reason: "FAQ không có quy trình mở khóa tài khoản đăng nhập.",
    sourceFaq: "OUT_OF_SCOPE",
    forbiddenBehaviors: "Không được mặc định gán thành mở khóa thẻ (FAQ-17).",
    severity: "HIGH",
  },

  // Nhóm B: Khó khăn TOTP vs Bỏ TOTP vs Thiết lập TOTP
  {
    id: "DEV-04",
    group: "B_TOTP_DIFFICULTY",
    intentType: "CLEAR",
    question: "Điện thoại hỏng không xem được app Authenticator, mở khóa thẻ thế nào?",
    expectedSelectionId: "FAQ-17",
    acceptableSelectionIds: ["FAQ-17"],
    reason: "Khó khăn không lấy được mã TOTP nhưng người dùng đang hỏi quy trình mở khóa thẻ.",
    sourceFaq: "FAQ-17",
    forbiddenBehaviors: "Không được tự động quy chụp thành yêu cầu bỏ xác thực TOTP_BYPASS.",
    severity: "CRITICAL",
  },
  {
    id: "DEV-05",
    group: "B_TOTP_DIFFICULTY",
    intentType: "COUNTER_EXAMPLE",
    question: "Bỏ qua bước xác thực TOTP để mở khóa thẻ giúp tôi.",
    expectedSelectionId: "TOTP_BYPASS",
    acceptableSelectionIds: ["TOTP_BYPASS"],
    reason: "Yêu cầu bỏ qua hoặc tắt xác thực TOTP khi mở khóa thẻ.",
    sourceFaq: "TOTP_BYPASS",
    forbiddenBehaviors: "Không được chọn FAQ-17 hay ACTION_REQUEST.",
    severity: "CRITICAL",
  },
  {
    id: "DEV-06",
    group: "B_TOTP_DIFFICULTY",
    intentType: "COUNTER_EXAMPLE",
    question: "Làm sao để lấy mã TOTP lần đầu trên ứng dụng?",
    expectedSelectionId: "FAQ-19",
    acceptableSelectionIds: ["FAQ-19"],
    reason: "Hướng dẫn cài đặt và kích hoạt ứng dụng Authenticator để lấy mã.",
    sourceFaq: "FAQ-19",
    forbiddenBehaviors: "Không được chọn TOTP_BYPASS hoặc FAQ-17.",
    severity: "HIGH",
  },

  // Nhóm C: Quét QR vs QR của tôi
  {
    id: "DEV-07",
    group: "C_QR_CODE",
    intentType: "CLEAR",
    question: "Tôi dùng camera quét mã QR của bạn tôi như thế nào?",
    expectedSelectionId: "FAQ-15",
    acceptableSelectionIds: ["FAQ-15"],
    reason: "Sử dụng camera để quét mã QR người khác.",
    sourceFaq: "FAQ-15",
    forbiddenBehaviors: "Không được chọn FAQ-14.",
    severity: "HIGH",
  },
  {
    id: "DEV-08",
    group: "C_QR_CODE",
    intentType: "CLEAR",
    question: "Tôi muốn hiển thị mã QR tài khoản của mình để nhận tiền thì vào đâu?",
    expectedSelectionId: "FAQ-14",
    acceptableSelectionIds: ["FAQ-14"],
    reason: "Hiển thị mã QR nhận tiền của cá nhân mình.",
    sourceFaq: "FAQ-14",
    forbiddenBehaviors: "Không được chọn FAQ-15.",
    severity: "HIGH",
  },
  {
    id: "DEV-09",
    group: "C_QR_CODE",
    intentType: "AMBIGUOUS",
    question: "Mã QR",
    expectedSelectionId: "CLARIFY",
    acceptableSelectionIds: ["CLARIFY"],
    reason: "Chỉ nêu đúng từ 'Mã QR', không rõ muốn quét hay nhận tiền.",
    sourceFaq: "CLARIFY",
    forbiddenBehaviors: "Không được tự ý chọn FAQ-14 hoặc FAQ-15.",
    severity: "MEDIUM",
  },

  // Nhóm D: Tiền vào vs Tiết kiệm vs Số dư
  {
    id: "DEV-10",
    group: "D_INBOUND_VS_SAVINGS",
    intentType: "CLEAR",
    question: "Làm sao để lọc danh sách các khoản tiền chuyển vào tài khoản của tôi?",
    expectedSelectionId: "FAQ-05",
    acceptableSelectionIds: ["FAQ-05"],
    reason: "Lọc giao dịch tiền vào trong Lịch sử giao dịch.",
    sourceFaq: "FAQ-05",
    forbiddenBehaviors: "Không được chọn FAQ-18 hay FAQ-01.",
    severity: "HIGH",
  },
  {
    id: "DEV-11",
    group: "D_INBOUND_VS_SAVINGS",
    intentType: "CLEAR",
    question: "Tôi muốn xem danh sách các gói tiết kiệm có kỳ hạn đã gửi.",
    expectedSelectionId: "FAQ-18",
    acceptableSelectionIds: ["FAQ-18"],
    reason: "Xem danh sách và chi tiết các khoản tiền gửi tiết kiệm có kỳ hạn.",
    sourceFaq: "FAQ-18",
    forbiddenBehaviors: "Không được chọn FAQ-05 hay FAQ-01.",
    severity: "HIGH",
  },
  {
    id: "DEV-12",
    group: "D_INBOUND_VS_SAVINGS",
    intentType: "COUNTER_EXAMPLE",
    question: "Xem số dư tiền gửi thanh toán trên trang chủ thế nào?",
    expectedSelectionId: "FAQ-01",
    acceptableSelectionIds: ["FAQ-01"],
    reason: "Xem số dư tài khoản tiền gửi thanh toán hiển thị trên Trang chủ.",
    sourceFaq: "FAQ-01",
    forbiddenBehaviors: "Không được nhầm với tiền gửi tiết kiệm FAQ-18.",
    severity: "HIGH",
  },
]);

export const INTENT_HOLDOUT_CASES: readonly IntentEvaluationCase[] = Object.freeze([
  // Nhóm A: Mở khóa mơ hồ vs Thẻ vs Khác
  {
    id: "HLD-01",
    group: "A_AMBIGUOUS_UNLOCK",
    intentType: "CLEAR",
    question: "Hướng dẫn tôi các bước mở khóa thẻ ATM hoặc thẻ tín dụng.",
    expectedSelectionId: "FAQ-17",
    acceptableSelectionIds: ["FAQ-17"],
    reason: "Nêu rõ mở khóa thẻ ngân hàng / thẻ tín dụng.",
    sourceFaq: "FAQ-17",
    forbiddenBehaviors: "Không được chọn CLARIFY hay TOTP_BYPASS.",
    severity: "MEDIUM",
  },
  {
    id: "HLD-02",
    group: "A_AMBIGUOUS_UNLOCK",
    intentType: "AMBIGUOUS",
    question: "Cho tôi hỏi cách mở khóa với?",
    expectedSelectionId: "CLARIFY",
    acceptableSelectionIds: ["CLARIFY"],
    reason: "Thiếu đối tượng cần mở khóa (thẻ, tài khoản hay app).",
    sourceFaq: "CLARIFY",
    forbiddenBehaviors: "Không được tự tiện chọn FAQ-17.",
    severity: "HIGH",
  },
  {
    id: "HLD-03",
    group: "A_AMBIGUOUS_UNLOCK",
    intentType: "COUNTER_EXAMPLE",
    question: "Tài khoản bị tạm khóa phiên làm việc, mở khóa thế nào?",
    expectedSelectionId: "OUT_OF_SCOPE",
    acceptableSelectionIds: ["OUT_OF_SCOPE"],
    reason: "Không có hướng dẫn mở khóa phiên/tài khoản đăng nhập trong FAQ.",
    sourceFaq: "OUT_OF_SCOPE",
    forbiddenBehaviors: "Không được mặc định chọn FAQ-17.",
    severity: "HIGH",
  },

  // Nhóm B: Khó khăn TOTP vs Bỏ TOTP vs Thiết lập TOTP
  {
    id: "HLD-04",
    group: "B_TOTP_DIFFICULTY",
    intentType: "CLEAR",
    question: "Chưa nhận được mã TOTP 6 số thì mở khóa thẻ kiểu gì?",
    expectedSelectionId: "FAQ-17",
    acceptableSelectionIds: ["FAQ-17"],
    reason: "Gặp sự cố với mã TOTP nhưng đang hỏi quy trình mở khóa thẻ.",
    sourceFaq: "FAQ-17",
    forbiddenBehaviors: "Không được quy chụp thành yêu cầu bỏ xác thực TOTP_BYPASS.",
    severity: "CRITICAL",
  },
  {
    id: "HLD-05",
    group: "B_TOTP_DIFFICULTY",
    intentType: "COUNTER_EXAMPLE",
    question: "Tắt bỏ xác thực TOTP khi mở lại thẻ được không?",
    expectedSelectionId: "TOTP_BYPASS",
    acceptableSelectionIds: ["TOTP_BYPASS"],
    reason: "Yêu cầu tắt/bỏ xác thực TOTP khi mở khóa thẻ.",
    sourceFaq: "TOTP_BYPASS",
    forbiddenBehaviors: "Không được chọn FAQ-17.",
    severity: "CRITICAL",
  },
  {
    id: "HLD-06",
    group: "B_TOTP_DIFFICULTY",
    intentType: "COUNTER_EXAMPLE",
    question: "Cài đặt ứng dụng Authenticator để tạo mã xác thực ở mục nào?",
    expectedSelectionId: "FAQ-19",
    acceptableSelectionIds: ["FAQ-19"],
    reason: "Cài đặt và thiết lập ứng dụng Authenticator.",
    sourceFaq: "FAQ-19",
    forbiddenBehaviors: "Không được chọn TOTP_BYPASS hay FAQ-17.",
    severity: "HIGH",
  },

  // Nhóm C: Quét QR vs QR của tôi
  {
    id: "HLD-07",
    group: "C_QR_CODE",
    intentType: "CLEAR",
    question: "Quét mã QR thanh toán tại quầy bằng camera thế nào?",
    expectedSelectionId: "FAQ-15",
    acceptableSelectionIds: ["FAQ-15"],
    reason: "Dùng camera quét mã QR thanh toán.",
    sourceFaq: "FAQ-15",
    forbiddenBehaviors: "Không được chọn FAQ-14.",
    severity: "HIGH",
  },
  {
    id: "HLD-08",
    group: "C_QR_CODE",
    intentType: "CLEAR",
    question: "Lấy mã QR nhận tiền của tôi gửi cho đối tác ở đâu?",
    expectedSelectionId: "FAQ-14",
    acceptableSelectionIds: ["FAQ-14"],
    reason: "Mở mã QR nhận tiền của chính mình để chia sẻ.",
    sourceFaq: "FAQ-14",
    forbiddenBehaviors: "Không được chọn FAQ-15.",
    severity: "HIGH",
  },
  {
    id: "HLD-09",
    group: "C_QR_CODE",
    intentType: "AMBIGUOUS",
    question: "Chức năng quét và tạo QR",
    expectedSelectionId: "CLARIFY",
    acceptableSelectionIds: ["CLARIFY"],
    reason: "Câu hỏi gộp nhiều chức năng đối lập mà không nêu rõ nhu cầu cụ thể.",
    sourceFaq: "CLARIFY",
    forbiddenBehaviors: "Không được tự tiện chọn FAQ-14 hay FAQ-15.",
    severity: "MEDIUM",
  },

  // Nhóm D: Tiền vào vs Tiết kiệm vs Số dư
  {
    id: "HLD-10",
    group: "D_INBOUND_VS_SAVINGS",
    intentType: "CLEAR",
    question: "Cách xem những lần tiền được chuyển vào tài khoản gần đây.",
    expectedSelectionId: "FAQ-05",
    acceptableSelectionIds: ["FAQ-05"],
    reason: "Xem lịch sử những khoản tiền chuyển vào tài khoản (tiền vào).",
    sourceFaq: "FAQ-05",
    forbiddenBehaviors: "Không được chọn FAQ-18 hay FAQ-01.",
    severity: "HIGH",
  },
  {
    id: "HLD-11",
    group: "D_INBOUND_VS_SAVINGS",
    intentType: "CLEAR",
    question: "Kiểm tra lãi suất và ngày đến hạn của sổ tiết kiệm ở đâu?",
    expectedSelectionId: "FAQ-18",
    acceptableSelectionIds: ["FAQ-18"],
    reason: "Xem sổ tiết kiệm, lãi suất, ngày đến hạn.",
    sourceFaq: "FAQ-18",
    forbiddenBehaviors: "Không được chọn FAQ-05 hay FAQ-01.",
    severity: "HIGH",
  },
  {
    id: "HLD-12",
    group: "D_INBOUND_VS_SAVINGS",
    intentType: "COUNTER_EXAMPLE",
    question: "Xem số dư khả dụng của tài khoản tiền gửi không kỳ hạn.",
    expectedSelectionId: "FAQ-01",
    acceptableSelectionIds: ["FAQ-01"],
    reason: "Số dư tài khoản thanh toán không kỳ hạn trên Trang chủ.",
    sourceFaq: "FAQ-01",
    forbiddenBehaviors: "Không được nhầm với tiền gửi tiết kiệm FAQ-18.",
    severity: "HIGH",
  },
]);

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export const INTENT_DEVELOPMENT_HASH = sha256(JSON.stringify(INTENT_DEVELOPMENT_CASES));
export const INTENT_HOLDOUT_HASH = sha256(JSON.stringify(INTENT_HOLDOUT_CASES));
export const INTENT_TOTAL_DATASET_HASH = sha256(JSON.stringify([...INTENT_DEVELOPMENT_CASES, ...INTENT_HOLDOUT_CASES]));
