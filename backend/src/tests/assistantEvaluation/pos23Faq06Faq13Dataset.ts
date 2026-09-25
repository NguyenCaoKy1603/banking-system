import { createHash } from "node:crypto";
import type { AnswerSelectionId } from "../../assistant/responseCatalog.js";

export const POS23_EXP_DATASET_VERSION = "nova-pos23-faq06-faq13-v1";

export type Pos23ExpGroup =
  | "FAQ03_ACCOUNT_DETAILS_AND_STATUS"
  | "FAQ06_TRANSACTION_INFO_LOCATION"
  | "FAQ13_PENDING_ACTION_HANDLING"
  | "FAQ01_QUICK_HOME_BALANCE";

export type Pos23ExpCase = {
  id: string;
  group: Pos23ExpGroup;
  intentGoal: string;
  question: string;
  expectedSelectionId: AnswerSelectionId;
  acceptableSelectionIds: readonly AnswerSelectionId[];
  reason: string;
  sourceFaq: string;
  sourceProof: string;
};

export const POS23_EXP_DEV_CASES: readonly Pos23ExpCase[] = Object.freeze([
  {
    id: "POS23-DEV-01",
    group: "FAQ03_ACCOUNT_DETAILS_AND_STATUS",
    intentGoal: "Hỏi nơi xem đồng thời số dư khả dụng và trạng thái tài khoản nguồn.",
    question: "Xem chi tiết số dư khả dụng và trạng thái tài khoản nguồn ở chỗ nào?",
    expectedSelectionId: "FAQ-03",
    acceptableSelectionIds: ["FAQ-03"],
    reason: "Câu hỏi yêu cầu cả số dư khả dụng lẫn trạng thái tài khoản nguồn. Chỉ có màn hình Chi tiết tài khoản (FAQ-03) đáp ứng đồng thời cả tên chủ tài khoản, ngân hàng, loại tiền, số dư và trạng thái (Đang hoạt động / Đã khóa).",
    sourceFaq: "FAQ-03",
    sourceProof: "assistant-help-faq.md (FAQ-03, dòng 132-133): Màn hình Chi tiết tài khoản hiển thị tên chủ tài khoản, ngân hàng, loại tiền (VND), số dư và trạng thái tài khoản (Đang hoạt động hoặc Đã khóa).",
  },
  {
    id: "POS23-DEV-02",
    group: "FAQ06_TRANSACTION_INFO_LOCATION",
    intentGoal: "Hỏi vị trí/nơi xem trạng thái của một giao dịch vừa chuyển tiền (thành công hay đang xử lý).",
    question: "Xem trạng thái giao dịch vừa chuyển tiền là thành công hay đang xử lý ở đâu?",
    expectedSelectionId: "FAQ-06",
    acceptableSelectionIds: ["FAQ-06"],
    reason: "Người dùng hỏi nơi tra cứu trạng thái ('ở đâu') của một giao dịch cụ thể sau khi chuyển. FAQ-06 hướng dẫn mở Trang chủ -> Lịch sử giao dịch -> chọn giao dịch để vào Chi tiết giao dịch, hiển thị trạng thái (Thành công, Đang xử lý, Thất bại, Hoàn tác), số tiền, phí, mã tham chiếu và thời gian.",
    sourceFaq: "FAQ-06",
    sourceProof: "assistant-help-faq.md (FAQ-06, dòng 180-184) và TransactionDetailScreen.tsx (dòng 34-44, 150): Màn hình Chi tiết giao dịch hiển thị StatusBadge với các trạng thái Đang xử lý, Thành công, Thất bại, Đã hoàn tác và Thông tin giao dịch.",
  },
  {
    id: "POS23-DEV-03",
    group: "FAQ13_PENDING_ACTION_HANDLING",
    intentGoal: "Báo tình trạng giao dịch chuyển tiền bị quay tròn/đang xử lý và hỏi bước xử lý hành động tiếp theo.",
    question: "Tôi vừa chuyển tiền mà màn hình quay tròn báo đang xử lý, giờ tôi phải làm gì?",
    expectedSelectionId: "FAQ-13",
    acceptableSelectionIds: ["FAQ-13"],
    reason: "Người dùng gặp sự cố chuyển tiền bị treo/quay tròn/đang xử lý và hỏi cách xử lý ('phải làm gì?'). FAQ-13 hướng dẫn chọn nút 'Cập nhật trạng thái' nếu có, kiểm tra lịch sử giao dịch và cảnh báo không tạo lệnh chuyển mới ngay để tránh trừ tiền hai lần.",
    sourceFaq: "FAQ-13",
    sourceProof: "assistant-help-faq.md (FAQ-13, dòng 290-301) và TransferScreen.tsx (dòng 981): Nút 'Cập nhật trạng thái' xuất hiện khi receipt.status === 'PENDING' hoặc khôi phục giao dịch.",
  },
  {
    id: "POS23-DEV-04",
    group: "FAQ01_QUICK_HOME_BALANCE",
    intentGoal: "Hỏi thao tác xem nhanh hoặc ẩn số dư tài khoản thanh toán trên Trang chủ.",
    question: "Làm sao để ẩn hoặc hiện số dư tài khoản trên màn hình chính?",
    expectedSelectionId: "FAQ-01",
    acceptableSelectionIds: ["FAQ-01"],
    reason: "Người dùng muốn biết cách ẩn/hiện số dư tài khoản thanh toán trên màn hình chính (Trang chủ). FAQ-01 hướng dẫn dùng biểu tượng con mắt 'Hiện số dư' / 'Ẩn số dư' trên thẻ tài khoản tại Trang chủ.",
    sourceFaq: "FAQ-01",
    sourceProof: "assistant-help-faq.md (FAQ-01, dòng 98-102): Trên tab Trang chủ, tìm thẻ tài khoản và chọn biểu tượng Hiện số dư / Ẩn số dư.",
  },
]);

export const POS23_EXP_HOLDOUT_CASES: readonly Pos23ExpCase[] = Object.freeze([
  {
    id: "POS23-HLD-01",
    group: "FAQ03_ACCOUNT_DETAILS_AND_STATUS",
    intentGoal: "Hỏi chỗ kiểm tra tình trạng tài khoản nguồn và thông tin số dư chi tiết (diễn đạt khác).",
    question: "Chỉ cho tôi chỗ kiểm tra tình trạng tài khoản nguồn và thông tin số dư chi tiết.",
    expectedSelectionId: "FAQ-03",
    acceptableSelectionIds: ["FAQ-03"],
    reason: "Yêu cầu kiểm tra tình trạng (trạng thái) tài khoản nguồn kèm thông tin số dư chi tiết. Màn hình Chi tiết tài khoản đáp ứng cả hai thông số này.",
    sourceFaq: "FAQ-03",
    sourceProof: "assistant-help-faq.md (FAQ-03, dòng 132): Màn hình Chi tiết tài khoản hiển thị: tên chủ tài khoản, ngân hàng, loại tiền (VND), số dư và trạng thái tài khoản.",
  },
  {
    id: "POS23-HLD-02",
    group: "FAQ06_TRANSACTION_INFO_LOCATION",
    intentGoal: "Hỏi mục tra cứu biên lai, trạng thái và thông tin của một lệnh chuyển tiền đã gửi (diễn đạt khác).",
    question: "Muốn kiểm tra biên lai và trạng thái của một lệnh chuyển tiền đã gửi thì vào phần nào?",
    expectedSelectionId: "FAQ-06",
    acceptableSelectionIds: ["FAQ-06"],
    reason: "Người dùng tìm nơi kiểm tra biên lai/thông tin chi tiết và trạng thái của một giao dịch chuyển tiền đã thực hiện. Màn hình Chi tiết giao dịch thuộc FAQ-06 đáp ứng thông tin này.",
    sourceFaq: "FAQ-06",
    sourceProof: "assistant-help-faq.md (FAQ-06, dòng 177, 180-184): Tra cứu chi tiết một giao dịch: trạng thái, số tiền, phí, mã tham chiếu, thời gian tạo và thời gian hoàn tất.",
  },
  {
    id: "POS23-HLD-03",
    group: "FAQ13_PENDING_ACTION_HANDLING",
    intentGoal: "Báo tình huống giao dịch chờ xử lý kéo dài và hỏi bước xử lý/có nên chuyển lại không (diễn đạt khác).",
    question: "App báo giao dịch đang chờ xử lý mãi chưa xong, tôi có nên chuyển lại hay cần bấm nút gì tiếp theo?",
    expectedSelectionId: "FAQ-13",
    acceptableSelectionIds: ["FAQ-13"],
    reason: "Tình huống giao dịch chuyển tiền bị chờ xử lý kéo dài và người dùng phân vân bước xử lý/có gửi lại lệnh không. FAQ-13 chỉ dẫn bấm 'Cập nhật trạng thái', đối soát lịch sử và tuyệt đối không gửi lại ngay.",
    sourceFaq: "FAQ-13",
    sourceProof: "assistant-help-faq.md (FAQ-13, dòng 290-301): Hướng dẫn khi gặp giao dịch đang chờ xử lý; lưu ý không tạo giao dịch mới ngay tránh trừ tiền hai lần.",
  },
  {
    id: "POS23-HLD-04",
    group: "FAQ01_QUICK_HOME_BALANCE",
    intentGoal: "Hỏi thao tác che/ẩn số dư khả dụng hiển thị trên Trang chủ để bảo vệ riêng tư (diễn đạt khác).",
    question: "Tôi muốn che số tiền khả dụng đang hiện ở Trang chủ để người khác không nhìn thấy thì bấm nút nào?",
    expectedSelectionId: "FAQ-01",
    acceptableSelectionIds: ["FAQ-01"],
    reason: "Người dùng muốn che số dư khả dụng đang hiển thị trên thẻ Trang chủ. FAQ-01 hướng dẫn bấm biểu tượng Hiện/Ẩn số dư hình con mắt trên thẻ tài khoản Trang chủ.",
    sourceFaq: "FAQ-01",
    sourceProof: "assistant-help-faq.md (FAQ-01, dòng 94, 99-102): Ý định che số dư để đảm bảo riêng tư bằng biểu tượng Ẩn số dư trên Trang chủ.",
  },
]);

function computeSha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export const POS23_EXP_DEV_HASH = computeSha256(JSON.stringify(POS23_EXP_DEV_CASES));
export const POS23_EXP_HOLDOUT_HASH = computeSha256(JSON.stringify(POS23_EXP_HOLDOUT_CASES));
