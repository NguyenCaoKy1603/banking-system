import { createHash } from "node:crypto";
import type { AnswerSelectionId } from "../../assistant/responseCatalog.js";

export const POS24_DATASET_VERSION = "pos24-disambiguation-v1.0";

export type Pos24EvaluationCase = {
  id: string;
  group: string;
  intentGoal: string;
  question: string;
  expectedSelectionId: AnswerSelectionId;
  acceptableSelectionIds: readonly AnswerSelectionId[];
  reason: string;
  boundaryRationale: string;
};

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export const POS24_DEV_CASES: readonly Pos24EvaluationCase[] = Object.freeze([
  {
    id: "POS24-DEV-01",
    group: "HISTORY_NAVIGATION",
    intentGoal: "Hỏi đường vào màn hình xem lịch sử biến động số dư chung.",
    question: "Tôi muốn kiểm tra lại các lần biến động số dư đã thực hiện thì vào đâu?",
    expectedSelectionId: "FAQ-04",
    acceptableSelectionIds: ["FAQ-04"],
    reason: "Hỏi vị trí xem các lần biến động số dư tổng thể, FAQ-04 hướng dẫn vào Quản lý -> Lịch sử giao dịch.",
    boundaryRationale: "Ca kiểm thử gốc POS-24: Hỏi đường vào màn hình lịch sử biến động số dư chung; không yêu cầu lọc.",
  },
  {
    id: "POS24-DEV-02",
    group: "HISTORY_NAVIGATION",
    intentGoal: "Hỏi nơi xem danh sách lịch sử chuyển tiền chung.",
    question: "Lịch sử chuyển tiền nằm ở chỗ nào trên ứng dụng?",
    expectedSelectionId: "FAQ-04",
    acceptableSelectionIds: ["FAQ-04"],
    reason: "Hỏi đường dẫn vào danh sách lịch sử chuyển tiền chung, không dùng từ 'biến động', thuộc FAQ-04.",
    boundaryRationale: "Hỏi nơi xem danh sách lịch sử chung, không dùng từ 'biến động'.",
  },
  {
    id: "POS24-DEV-03",
    group: "HISTORY_FILTER",
    intentGoal: "Lọc riêng các khoản tiền nhận về tài khoản.",
    question: "Chỉ mình cách xem riêng những khoản tiền vừa nhận về tài khoản.",
    expectedSelectionId: "FAQ-05",
    acceptableSelectionIds: ["FAQ-05"],
    reason: "Lọc dòng tiền vào trong Lịch sử giao dịch, thuộc FAQ-05.",
    boundaryRationale: "Ca bảo vệ POS-25: Có ý định lọc cụ thể dòng tiền vào ('tiền vừa nhận').",
  },
  {
    id: "POS24-DEV-04",
    group: "HISTORY_FILTER",
    intentGoal: "Lọc riêng các khoản tiền đã chuyển đi.",
    question: "Làm sao lọc để chỉ thấy các khoản tiền đã chuyển đi?",
    expectedSelectionId: "FAQ-05",
    acceptableSelectionIds: ["FAQ-05"],
    reason: "Lọc dòng tiền ra trong Lịch sử giao dịch, thuộc FAQ-05.",
    boundaryRationale: "Có ý định lọc cụ thể dòng tiền ra ('tiền chuyển đi').",
  },
  {
    id: "POS24-DEV-05",
    group: "HISTORY_FILTER",
    intentGoal: "Lọc giao dịch theo trạng thái thất bại.",
    question: "Tôi muốn xem danh sách các giao dịch bị thất bại thì lọc thế nào?",
    expectedSelectionId: "FAQ-05",
    acceptableSelectionIds: ["FAQ-05"],
    reason: "Lọc theo trạng thái giao dịch trong Lịch sử giao dịch, thuộc FAQ-05.",
    boundaryRationale: "Có ý định lọc cụ thể theo trạng thái xử lý ('thất bại').",
  },
  {
    id: "POS24-DEV-06",
    group: "TRANSACTION_DETAIL",
    intentGoal: "Hỏi nơi xem thông số của một giao dịch cụ thể.",
    question: "Xem phí và mã tham chiếu của một giao dịch cụ thể ở đâu?",
    expectedSelectionId: "FAQ-06",
    acceptableSelectionIds: ["FAQ-06"],
    reason: "Tra cứu phí và mã tham chiếu của một giao dịch cụ thể trong Chi tiết giao dịch, thuộc FAQ-06.",
    boundaryRationale: "Ca bảo vệ FAQ-06: Hỏi nơi xem biên nhận/thông số của một giao dịch cụ thể.",
  },
  {
    id: "POS24-DEV-07",
    group: "PENDING_INCIDENT",
    intentGoal: "Báo sự cố chuyển tiền đang xử lý và hỏi bước xử lý tiếp theo.",
    question: "Vừa chuyển tiền bị quay tròn trừ tiền mà chưa nhận được thì làm gì?",
    expectedSelectionId: "FAQ-13",
    acceptableSelectionIds: ["FAQ-13"],
    reason: "Gặp sự cố pending/timeout, hỏi bước xử lý tiếp theo (không chuyển lại ngay, bấm cập nhật trạng thái), thuộc FAQ-13.",
    boundaryRationale: "Ca bảo vệ FAQ-13: Báo sự cố timeout/pending sau khi gửi, hỏi bước xử lý tiếp theo.",
  },
  {
    id: "POS24-DEV-08",
    group: "ACCOUNT_DETAILS",
    intentGoal: "Hỏi đồng thời số dư và trạng thái tài khoản nguồn.",
    question: "Xem chi tiết số dư khả dụng và trạng thái tài khoản nguồn ở chỗ nào?",
    expectedSelectionId: "FAQ-03",
    acceptableSelectionIds: ["FAQ-03"],
    reason: "Yêu cầu cả số dư khả dụng và trạng thái tài khoản nguồn, thuộc FAQ-03.",
    boundaryRationale: "Ca bảo vệ POS-23: Hỏi đồng thời số dư và trạng thái tài khoản nguồn -> bắt buộc chọn FAQ-03.",
  },
]);

export const POS24_DIAG_CASES: readonly Pos24EvaluationCase[] = Object.freeze([
  {
    id: "POS24-DIAG-01",
    group: "HISTORY_NAVIGATION",
    intentGoal: "Hỏi vị trí mục chức năng trên Trang chủ để xem biến động tài khoản.",
    question: "Muốn tra cứu các biến động tài khoản trong tháng thì bấm vào mục nào trên Trang chủ?",
    expectedSelectionId: "FAQ-04",
    acceptableSelectionIds: ["FAQ-04"],
    reason: "Hỏi vị trí mục chức năng trên Trang chủ để xem biến động tài khoản tổng thể, thuộc FAQ-04.",
    boundaryRationale: "Hỏi vị trí mục chức năng trên Trang chủ để xem biến động tài khoản.",
  },
  {
    id: "POS24-DIAG-02",
    group: "HISTORY_NAVIGATION",
    intentGoal: "Tra cứu nhật ký giao dịch cũ tổng thể.",
    question: "Xem lại nhật ký các giao dịch cũ đã phát sinh từ trước đến nay ở đâu?",
    expectedSelectionId: "FAQ-04",
    acceptableSelectionIds: ["FAQ-04"],
    reason: "Tra cứu nhật ký giao dịch cũ, thuộc FAQ-04.",
    boundaryRationale: "Tra cứu nhật ký giao dịch cũ tổng thể.",
  },
  {
    id: "POS24-DIAG-03",
    group: "HISTORY_FILTER",
    intentGoal: "Phân loại hiển thị chỉ giao dịch nhận tiền (dòng tiền vào).",
    question: "Cách phân loại để chỉ hiện các giao dịch nhận tiền từ người khác.",
    expectedSelectionId: "FAQ-05",
    acceptableSelectionIds: ["FAQ-05"],
    reason: "Phân loại dòng tiền vào, thuộc FAQ-05.",
    boundaryRationale: "Phân loại hiển thị chỉ giao dịch nhận tiền (dòng tiền vào).",
  },
  {
    id: "POS24-DIAG-04",
    group: "HISTORY_FILTER",
    intentGoal: "Phân loại tách riêng tiền chi ra (dòng tiền ra).",
    question: "Tôi muốn tách riêng các khoản tiền chi ra trong lịch sử để xem.",
    expectedSelectionId: "FAQ-05",
    acceptableSelectionIds: ["FAQ-05"],
    reason: "Tách riêng tiền chi ra trong lịch sử, thuộc FAQ-05.",
    boundaryRationale: "Phân loại tách riêng tiền chi ra (dòng tiền ra).",
  },
  {
    id: "POS24-DIAG-05",
    group: "HISTORY_FILTER",
    intentGoal: "Lọc theo trạng thái chờ xử lý trong màn hình lịch sử.",
    question: "Làm thế nào để kiểm tra riêng những giao dịch đang ở trạng thái chờ xử lý trong lịch sử?",
    expectedSelectionId: "FAQ-05",
    acceptableSelectionIds: ["FAQ-05"],
    reason: "Lọc theo trạng thái chờ xử lý, thuộc FAQ-05.",
    boundaryRationale: "Lọc theo trạng thái chờ xử lý trong màn hình lịch sử.",
  },
  {
    id: "POS24-DIAG-06",
    group: "TRANSACTION_DETAIL",
    intentGoal: "Tra cứu thông tin biên lai của một món tiền cụ thể.",
    question: "Tìm biên lai và thời gian hoàn tất của món tiền đã gửi hôm qua ở chỗ nào?",
    expectedSelectionId: "FAQ-06",
    acceptableSelectionIds: ["FAQ-06"],
    reason: "Tra cứu biên lai và thời gian hoàn tất của một giao dịch cụ thể, thuộc FAQ-06.",
    boundaryRationale: "Tra cứu thông tin biên lai của một món tiền cụ thể.",
  },
  {
    id: "POS24-DIAG-07",
    group: "PENDING_INCIDENT",
    intentGoal: "Hỏi hướng dẫn ứng xử an toàn khi giao dịch bị treo.",
    question: "App báo giao dịch đang xử lý mãi không xong, tôi có nên bấm chuyển lại không?",
    expectedSelectionId: "FAQ-13",
    acceptableSelectionIds: ["FAQ-13"],
    reason: "Giao dịch xử lý lâu, hỏi có nên chuyển lại không, thuộc FAQ-13.",
    boundaryRationale: "Hỏi hướng dẫn ứng xử an toàn khi giao dịch bị treo.",
  },
  {
    id: "POS24-DIAG-08",
    group: "ACCOUNT_DETAILS",
    intentGoal: "Hỏi tình trạng hoạt động và thông số chi tiết của tài khoản.",
    question: "Kiểm tra tình trạng tài khoản thanh toán và các thông số tài khoản ở đâu?",
    expectedSelectionId: "FAQ-03",
    acceptableSelectionIds: ["FAQ-03"],
    reason: "Hỏi tình trạng hoạt động và thông số chi tiết của tài khoản, thuộc FAQ-03.",
    boundaryRationale: "Hỏi tình trạng hoạt động và thông số chi tiết của tài khoản.",
  },
]);

export const POS24_DEV_HASH = sha256(JSON.stringify(POS24_DEV_CASES));
export const POS24_DIAG_HASH = sha256(JSON.stringify(POS24_DIAG_CASES));
