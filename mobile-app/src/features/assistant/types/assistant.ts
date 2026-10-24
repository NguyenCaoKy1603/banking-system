export type AssistantHelpRequest = {
  question: string;
};

export type AssistantHelpResponse = {
  answer: string;
};

export const MAX_QUESTION_CODE_POINTS = 500;

/**
 * Đếm số lượng ký tự Unicode code points theo đúng chuẩn Backend runtime validator.
 */
export function countCodePoints(text: string): number {
  return [...text].length;
}

/**
 * Runtime validator bảo đảm response từ Backend có dạng `{ answer: string }`,
 * ngăn chặn object/HTML/JSON lỗi không mong muốn hiển thị lên UI.
 */
export function isAssistantHelpResponse(
  payload: unknown,
): payload is AssistantHelpResponse {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return false;
  }

  const candidate = payload as Record<string, unknown>;
  return typeof candidate.answer === "string";
}

export type AssistantTurnStatus = "idle" | "loading" | "success" | "error";

export type AssistantTurnState = {
  status: AssistantTurnStatus;
  question: string;
  answer: string | null;
  errorMessage: string | null;
};
