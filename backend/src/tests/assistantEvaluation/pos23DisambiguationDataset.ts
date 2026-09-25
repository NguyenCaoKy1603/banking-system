import { createHash } from "node:crypto";
import type { AnswerSelectionId } from "../../assistant/responseCatalog.js";

export const POS23_DATASET_VERSION = "nova-pos23-disambiguation-v1";

export type Pos23Group =
  | "A_QUICK_BALANCE"
  | "B_ACCOUNT_DETAILS_STATUS"
  | "C_COMBINED_BALANCE_STATUS"
  | "D_BORDER_TOPICS";

export type Pos23EvaluationCase = {
  id: string;
  group: Pos23Group;
  question: string;
  expectedSelectionId: AnswerSelectionId;
  acceptableSelectionIds: readonly AnswerSelectionId[];
  reason: string;
  sourceFaq: string;
};

export const POS23_DEV_CASES: readonly Pos23EvaluationCase[] = Object.freeze([
  // Nhóm A: Xem nhanh/ẩn hiện số dư (FAQ-01)
  {
    id: "POS23-DEV-01",
    group: "A_QUICK_BALANCE",
    question: "Tôi muốn xem nhanh số dư khả dụng ngay trên Trang chủ thì bật ở đâu?",
    expectedSelectionId: "FAQ-01",
    acceptableSelectionIds: ["FAQ-01"],
    reason: "Xem nhanh số dư tài khoản thanh toán trên Trang chủ.",
    sourceFaq: "FAQ-01",
  },
  {
    id: "POS23-DEV-02",
    group: "A_QUICK_BALANCE",
    question: "Làm sao để ẩn số dư tài khoản đang hiển thị ở màn hình chính?",
    expectedSelectionId: "FAQ-01",
    acceptableSelectionIds: ["FAQ-01"],
    reason: "Ẩn số dư tài khoản thanh toán đầu tiên trên Trang chủ.",
    sourceFaq: "FAQ-01",
  },
  {
    id: "POS23-DEV-03",
    group: "A_QUICK_BALANCE",
    question: "Nút hiện số dư hiện tại của tài khoản thanh toán nằm ở đâu?",
    expectedSelectionId: "FAQ-01",
    acceptableSelectionIds: ["FAQ-01"],
    reason: "Biểu tượng Hiện số dư trên thẻ tài khoản tại Trang chủ.",
    sourceFaq: "FAQ-01",
  },

  // Nhóm B: Chi tiết và trạng thái tài khoản (FAQ-03)
  {
    id: "POS23-DEV-04",
    group: "B_ACCOUNT_DETAILS_STATUS",
    question: "Mở màn hình xem trạng thái hoạt động của tài khoản ngân hàng ở đâu?",
    expectedSelectionId: "FAQ-03",
    acceptableSelectionIds: ["FAQ-03"],
    reason: "Xem trạng thái tài khoản thanh toán tại màn hình Chi tiết tài khoản.",
    sourceFaq: "FAQ-03",
  },
  {
    id: "POS23-DEV-05",
    group: "B_ACCOUNT_DETAILS_STATUS",
    question: "Tôi muốn kiểm tra thông tin chi tiết chủ tài khoản và loại tiền tệ của tài khoản nguồn.",
    expectedSelectionId: "FAQ-03",
    acceptableSelectionIds: ["FAQ-03"],
    reason: "Màn hình Chi tiết tài khoản hiển thị thông tin chủ tài khoản, loại tiền tệ.",
    sourceFaq: "FAQ-03",
  },
  {
    id: "POS23-DEV-06",
    group: "B_ACCOUNT_DETAILS_STATUS",
    question: "Xem thông tin ngân hàng và trạng thái hiện tại của tài khoản thanh toán.",
    expectedSelectionId: "FAQ-03",
    acceptableSelectionIds: ["FAQ-03"],
    reason: "Màn hình Chi tiết tài khoản hiển thị ngân hàng và trạng thái tài khoản.",
    sourceFaq: "FAQ-03",
  },

  // Nhóm C: Đồng thời hỏi số dư và thông tin/trạng thái tài khoản (FAQ-03)
  {
    id: "POS23-DEV-07",
    group: "C_COMBINED_BALANCE_STATUS",
    question: "Tôi muốn xem số dư và kiểm tra trạng thái tài khoản thanh toán cùng một chỗ thì vào đâu?",
    expectedSelectionId: "FAQ-03",
    acceptableSelectionIds: ["FAQ-03"],
    reason: "Yêu cầu cả số dư và trạng thái tài khoản; màn hình Chi tiết tài khoản đáp ứng cả hai.",
    sourceFaq: "FAQ-03",
  },
  {
    id: "POS23-DEV-08",
    group: "C_COMBINED_BALANCE_STATUS",
    question: "Chỉ tôi chỗ xem thông tin tài khoản nguồn gồm số dư khả dụng lẫn tình trạng tài khoản.",
    expectedSelectionId: "FAQ-03",
    acceptableSelectionIds: ["FAQ-03"],
    reason: "Hỏi cả số dư khả dụng và tình trạng tài khoản nguồn; chỉ FAQ-03 bao gồm cả hai.",
    sourceFaq: "FAQ-03",
  },
  {
    id: "POS23-DEV-09",
    group: "C_COMBINED_BALANCE_STATUS",
    question: "Vào đâu để xem chi tiết tài khoản bao gồm cả số dư và trạng thái hoạt động?",
    expectedSelectionId: "FAQ-03",
    acceptableSelectionIds: ["FAQ-03"],
    reason: "Chi tiết tài khoản bao gồm đồng thời số dư và trạng thái hoạt động.",
    sourceFaq: "FAQ-03",
  },

  // Nhóm D: Chủ đề lân cận (FAQ-02, FAQ-06, FAQ-05)
  {
    id: "POS23-DEV-10",
    group: "D_BORDER_TOPICS",
    question: "Tôi muốn sao chép số tài khoản của mình để gửi cho bạn bè.",
    expectedSelectionId: "FAQ-02",
    acceptableSelectionIds: ["FAQ-02"],
    reason: "Sao chép số tài khoản vào bộ nhớ tạm.",
    sourceFaq: "FAQ-02",
  },
  {
    id: "POS23-DEV-11",
    group: "D_BORDER_TOPICS",
    question: "Xem trạng thái giao dịch vừa chuyển tiền là thành công hay đang xử lý ở đâu?",
    expectedSelectionId: "FAQ-06",
    acceptableSelectionIds: ["FAQ-06"],
    reason: "Trạng thái giao dịch chuyển tiền (không phải trạng thái tài khoản).",
    sourceFaq: "FAQ-06",
  },
  {
    id: "POS23-DEV-12",
    group: "D_BORDER_TOPICS",
    question: "Lọc các khoản tiền vào tài khoản trong lịch sử giao dịch thế nào?",
    expectedSelectionId: "FAQ-05",
    acceptableSelectionIds: ["FAQ-05"],
    reason: "Lọc giao dịch tiền vào trong Lịch sử giao dịch.",
    sourceFaq: "FAQ-05",
  },
]);

export const POS23_HOLDOUT_CASES: readonly Pos23EvaluationCase[] = Object.freeze([
  // Nhóm A: Xem nhanh/ẩn hiện số dư (FAQ-01)
  {
    id: "POS23-HLD-01",
    group: "A_QUICK_BALANCE",
    question: "Làm thế nào để che số dư tài khoản trên màn hình Trang chủ?",
    expectedSelectionId: "FAQ-01",
    acceptableSelectionIds: ["FAQ-01"],
    reason: "Ẩn số dư tài khoản trên Trang chủ.",
    sourceFaq: "FAQ-01",
  },
  {
    id: "POS23-HLD-02",
    group: "A_QUICK_BALANCE",
    question: "Xem số dư khả dụng và số dư hiện tại trên tab Trang chủ ở chỗ nào?",
    expectedSelectionId: "FAQ-01",
    acceptableSelectionIds: ["FAQ-01"],
    reason: "Xem số dư khả dụng và hiện tại trên thẻ Trang chủ.",
    sourceFaq: "FAQ-01",
  },
  {
    id: "POS23-HLD-03",
    group: "A_QUICK_BALANCE",
    question: "Bấm vào đâu để hiện số dư tài khoản thanh toán đầu tiên?",
    expectedSelectionId: "FAQ-01",
    acceptableSelectionIds: ["FAQ-01"],
    reason: "Chọn biểu tượng Hiện số dư trên thẻ đầu tiên.",
    sourceFaq: "FAQ-01",
  },

  // Nhóm B: Chi tiết và trạng thái tài khoản (FAQ-03)
  {
    id: "POS23-HLD-04",
    group: "B_ACCOUNT_DETAILS_STATUS",
    question: "Màn hình hiển thị trạng thái tài khoản và thông tin chi tiết mở bằng cách nào?",
    expectedSelectionId: "FAQ-03",
    acceptableSelectionIds: ["FAQ-03"],
    reason: "Mở màn hình Chi tiết tài khoản để xem trạng thái tài khoản.",
    sourceFaq: "FAQ-03",
  },
  {
    id: "POS23-HLD-05",
    group: "B_ACCOUNT_DETAILS_STATUS",
    question: "Kiểm tra xem tài khoản thanh toán của tôi đang ở trạng thái nào thì vào đâu?",
    expectedSelectionId: "FAQ-03",
    acceptableSelectionIds: ["FAQ-03"],
    reason: "Kiểm tra trạng thái tài khoản thanh toán.",
    sourceFaq: "FAQ-03",
  },
  {
    id: "POS23-HLD-06",
    group: "B_ACCOUNT_DETAILS_STATUS",
    question: "Tôi muốn xem thông tin chi tiết về chủ tài khoản và tên ngân hàng của tài khoản này.",
    expectedSelectionId: "FAQ-03",
    acceptableSelectionIds: ["FAQ-03"],
    reason: "Xem chi tiết chủ tài khoản và ngân hàng.",
    sourceFaq: "FAQ-03",
  },

  // Nhóm C: Đồng thời hỏi số dư và thông tin/trạng thái tài khoản (FAQ-03)
  {
    id: "POS23-HLD-07",
    group: "C_COMBINED_BALANCE_STATUS",
    question: "Xem toàn bộ thông tin tài khoản nguồn từ số dư cho tới trạng thái tài khoản ở màn hình nào?",
    expectedSelectionId: "FAQ-03",
    acceptableSelectionIds: ["FAQ-03"],
    reason: "Xem thông tin tài khoản từ số dư đến trạng thái tài khoản nguồn.",
    sourceFaq: "FAQ-03",
  },
  {
    id: "POS23-HLD-08",
    group: "C_COMBINED_BALANCE_STATUS",
    question: "Chỗ nào vừa kiểm tra được trạng thái tài khoản lại vừa thấy chi tiết số dư?",
    expectedSelectionId: "FAQ-03",
    acceptableSelectionIds: ["FAQ-03"],
    reason: "Cần cả kiểm tra trạng thái tài khoản và thấy số dư.",
    sourceFaq: "FAQ-03",
  },
  {
    id: "POS23-HLD-09",
    group: "C_COMBINED_BALANCE_STATUS",
    question: "Hướng dẫn mở phần chi tiết để xem trạng thái và số dư hiện tại của tài khoản thanh toán.",
    expectedSelectionId: "FAQ-03",
    acceptableSelectionIds: ["FAQ-03"],
    reason: "Mở chi tiết tài khoản xem trạng thái và số dư hiện tại.",
    sourceFaq: "FAQ-03",
  },

  // Nhóm D: Chủ đề lân cận (FAQ-02, FAQ-06, FAQ-05)
  {
    id: "POS23-HLD-10",
    group: "D_BORDER_TOPICS",
    question: "Làm sao để hiện đầy đủ số tài khoản bị che trên màn hình chính?",
    expectedSelectionId: "FAQ-02",
    acceptableSelectionIds: ["FAQ-02"],
    reason: "Hiện đầy đủ số tài khoản trên thẻ tài khoản.",
    sourceFaq: "FAQ-02",
  },
  {
    id: "POS23-HLD-11",
    group: "D_BORDER_TOPICS",
    question: "Kiểm tra mã tham chiếu và phí của một giao dịch đã thực hiện ở đâu?",
    expectedSelectionId: "FAQ-06",
    acceptableSelectionIds: ["FAQ-06"],
    reason: "Tra cứu phí, trạng thái và mã tham chiếu của giao dịch.",
    sourceFaq: "FAQ-06",
  },
  {
    id: "POS23-HLD-12",
    group: "D_BORDER_TOPICS",
    question: "Xem danh sách các giao dịch nhận tiền thành công gần đây trong phần lịch sử.",
    expectedSelectionId: "FAQ-05",
    acceptableSelectionIds: ["FAQ-05"],
    reason: "Xem giao dịch nhận tiền trong Lịch sử giao dịch.",
    sourceFaq: "FAQ-05",
  },
]);

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export const POS23_DEV_HASH = sha256(JSON.stringify(POS23_DEV_CASES));
export const POS23_HOLDOUT_HASH = sha256(JSON.stringify(POS23_HOLDOUT_CASES));
export const POS23_TOTAL_DATASET_HASH = sha256(JSON.stringify([...POS23_DEV_CASES, ...POS23_HOLDOUT_CASES]));
