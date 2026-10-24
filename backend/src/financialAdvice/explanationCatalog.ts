import { formatVnd } from "./calculations.js";
import type {
  BudgetBalanceCalculations,
  SavingsPlanCalculations,
} from "./calculations.js";
import type {
  FallbackReason,
  FinancialOptionId,
  FinancialPreference,
  ReasonId,
} from "./types.js";

export const CATALOG_VERSION = "fa-catalog-v2";
export const CALCULATION_VERSION = "fa-calc-v1";

export const STANDARD_ASSUMPTIONS = [
  "Thu nhập và các khoản chi khai báo được giữ nguyên trong toàn bộ phép tính.",
  "Chưa tính lãi, lạm phát, phí và các khoản ngoài dữ liệu đã nhập.",
  "Kết quả là kế hoạch tham khảo trong hệ thống đồ án.",
];

export const FALLBACK_ASSUMPTION =
  "Phần AI hiện chưa khả dụng hoặc trả lời không phù hợp; giải thích hiện tại được tạo theo quy tắc.";

export function renderSavingsParagraphs(
  calc: SavingsPlanCalculations,
  preferredOptionId: FinancialOptionId,
  reasonIds: ReasonId[],
  preference: FinancialPreference,
): string[] {
  const { R, H, Q, C, J, baseDeficit } = calc.raw;
  const paragraphs: string[] = [];

  // Paragraph 1: Goal overview
  if (R === 0n) {
    paragraphs.push(
      "Mục tiêu của bạn đã có đủ số tiền theo thông tin đã dành riêng. Bạn không cần phải tích lũy thêm cho mục tiêu này.",
    );
  } else {
    paragraphs.push(
      `Mục tiêu cần thêm ${formatVnd(R)}. Trong ${H} tháng, mỗi tháng cần dành ${formatVnd(Q)}.`,
    );
  }

  // Paragraph 2: Monthly capacity vs required
  if (R > 0n) {
    if (C <= 0n) {
      if (baseDeficit > 0n) {
        paragraphs.push(
          `Ngân sách tháng hiện đang thâm hụt ${formatVnd(baseDeficit)}, chưa có khoản kết dư để trích cho mục tiêu tiết kiệm.`,
        );
      } else {
        paragraphs.push(
          "Sau các khoản chi phí và khoản muốn giữ lại, bạn chưa có thêm thặng dư để trích cho mục tiêu này.",
        );
      }
    } else if (J > 0n) {
      paragraphs.push(
        `Sau các khoản đã khai báo và khoản muốn giữ lại, bạn còn ${formatVnd(C)} mỗi tháng, thiếu ${formatVnd(J)} so với kế hoạch.`,
      );
    } else {
      const remainingAfterGoal = C - Q;
      paragraphs.push(
        `Sau các khoản đã khai báo và khoản muốn giữ lại, bạn còn ${formatVnd(C)} mỗi tháng, đủ đáp ứng số tiền cần dành (${formatVnd(Q)}/tháng). Khoản còn lại sau mục tiêu là ${formatVnd(remainingAfterGoal)}.`,
      );
    }
  }

  // Paragraph 3: Strategic rationale
  if (preferredOptionId === "EXTEND_DEADLINE") {
    if (preference === "KEEP_CURRENT_SPENDING") {
      paragraphs.push(
        "Vì bạn ưu tiên giữ mức chi hiện tại, phương án kéo dài thời hạn là một lựa chọn để cân nhắc.",
      );
    } else {
      paragraphs.push(
        "Phương án kéo dài thời hạn giúp bạn hoàn thành mục tiêu mà không phải chịu áp lực cắt giảm chi tiêu.",
      );
    }
  } else if (preferredOptionId === "REDUCE_FLEXIBLE_SPENDING") {
    if (preference === "KEEP_TARGET") {
      paragraphs.push(
        "Vì bạn ưu tiên mục tiêu, phương án điều chỉnh chi phí linh hoạt giúp bạn đạt mục tiêu đúng hạn.",
      );
    } else {
      paragraphs.push(
        "Cân nhắc tiết giảm chi tiêu linh hoạt để bù đắp phần còn thiếu mỗi tháng.",
      );
    }
  } else if (preferredOptionId === "LOWER_GOAL_AMOUNT") {
    paragraphs.push(
      "Phương án điều chỉnh mục tiêu giúp bạn giữ nguyên thời hạn và mức chi tiêu sinh hoạt hiện tại.",
    );
  } else if (preferredOptionId === "REVIEW_BASE_BUDGET") {
    paragraphs.push(
      "Bạn nên rà soát lại toàn bộ các nguồn thu và nghĩa vụ chi tiêu cơ bản để tìm giải pháp cải thiện dòng tiền.",
    );
  } else if (preferredOptionId === "MAINTAIN_PLAN") {
    paragraphs.push(
      "Kế hoạch tài chính hiện tại khả thi; bạn có thể duy trì đều đặn để đạt mục tiêu.",
    );
  }

  return paragraphs;
}

export function renderBudgetParagraphs(
  calc: BudgetBalanceCalculations,
  preferredOptionId: FinancialOptionId,
  reasonIds: ReasonId[],
  preference: FinancialPreference,
): string[] {
  const { S, C, G, targetGap, baseDeficit } = calc.raw;
  const paragraphs: string[] = [];

  // Paragraph 1: Base cash flow
  if (baseDeficit > 0n) {
    paragraphs.push(
      `Ngân sách tháng hiện đang thâm hụt ${formatVnd(baseDeficit)} giữa tổng chi tiêu đã khai báo và thu nhập thực nhận.`,
    );
  } else if (S === 0n) {
    paragraphs.push(
      "Ngân sách tháng đang ở trạng thái cân bằng chính xác giữa thu nhập và các khoản chi đã khai báo.",
    );
  } else {
    paragraphs.push(
      `Ngân sách còn ${formatVnd(S)} trước khoản giữ lại và ${formatVnd(C)} sau khoản muốn giữ lại.`,
    );
  }

  // Paragraph 2: Target comparison
  if (G === 0n) {
    paragraphs.push(
      "Bạn không đặt mục tiêu tiết kiệm thêm hàng tháng cho đợt cân đối ngân sách này.",
    );
  } else if (C >= G) {
    const surplus = C - G;
    paragraphs.push(
      `Mức tiết kiệm mong muốn là ${formatVnd(G)}. Bạn có đủ khả năng trích khoản này, còn lại ${formatVnd(surplus)} sau mục tiêu.`,
    );
  } else {
    paragraphs.push(
      `Mức tiết kiệm mong muốn là ${formatVnd(G)}, thiếu ${formatVnd(targetGap)} theo kế hoạch.`,
    );
  }

  // Paragraph 3: Rationale
  if (preferredOptionId === "REDUCE_FLEXIBLE_SPENDING") {
    if (preference === "KEEP_TARGET") {
      paragraphs.push(
        "Vì bạn ưu tiên mục tiêu, có thể cân nhắc giảm chi phí linh hoạt nếu khoản điều chỉnh phù hợp.",
      );
    } else {
      paragraphs.push(
        "Cắt giảm chi phí linh hoạt là phương án khả thi để đạt mức tiết kiệm mong muốn.",
      );
    }
  } else if (preferredOptionId === "ADJUST_SAVINGS_TARGET") {
    if (preference === "KEEP_CURRENT_SPENDING") {
      paragraphs.push(
        "Vì bạn ưu tiên giữ mức chi, điều chỉnh mục tiêu tiết kiệm về mức khả thi là lựa chọn phù hợp.",
      );
    } else {
      paragraphs.push(
        "Điều chỉnh mức tiết kiệm theo khả năng thực tế giúp kế hoạch không bị quá tải.",
      );
    }
  } else if (preferredOptionId === "REVIEW_BASE_BUDGET") {
    paragraphs.push(
      "Nên rà soát lại các khoản chi cố định, nghĩa vụ nợ hoặc tăng thu nhập để cải thiện cán cân ngân sách.",
    );
  } else if (preferredOptionId === "MAINTAIN_BUDGET") {
    paragraphs.push(
      "Ngân sách đang ở mức an toàn và đáp ứng được mục tiêu tiết kiệm bạn đề ra.",
    );
  }

  return paragraphs;
}

export function buildAssumptions(fallbackReason: FallbackReason | null): string[] {
  const assumptions = [...STANDARD_ASSUMPTIONS];
  if (fallbackReason !== null) {
    assumptions.push(FALLBACK_ASSUMPTION);
  }
  return assumptions;
}
