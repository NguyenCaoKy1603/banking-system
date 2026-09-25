import { requestJson, type RequestAuth } from "@/services/api/httpClient";
import {
  type AssistantHelpResponse,
  countCodePoints,
  isAssistantHelpResponse,
  MAX_QUESTION_CODE_POINTS,
} from "@/features/assistant/types/assistant";

export const ASSISTANT_CLIENT_TIMEOUT_MS = 35_000;

export type AskAssistantOptions = {
  auth?: RequestAuth;
  signal?: AbortSignal;
  timeoutMs?: number;
};

/**
 * Gửi câu hỏi hướng dẫn tới endpoint POST /api/v1/assistant/help qua httpClient dùng chung.
 * Chuẩn hóa Unicode NFC, cắt khoảng trắng và kiểm tra giới hạn Unicode code point trước khi gửi.
 */
export async function askAssistantHelp(
  rawQuestion: string,
  options: AskAssistantOptions = {},
): Promise<AssistantHelpResponse> {
  const normalized = rawQuestion.trim().normalize("NFC");
  const codePoints = countCodePoints(normalized);

  if (codePoints === 0) {
    throw new Error("Vui lòng nhập câu hỏi trước khi gửi.");
  }

  if (codePoints > MAX_QUESTION_CODE_POINTS) {
    throw new Error(
      `Câu hỏi vượt quá giới hạn cho phép (${codePoints}/${MAX_QUESTION_CODE_POINTS} ký tự). Vui lòng rút ngắn câu hỏi.`,
    );
  }

  return requestJson<AssistantHelpResponse>(
    "/assistant/help",
    {
      method: "POST",
      body: { question: normalized },
      auth: options.auth,
      signal: options.signal,
      timeoutMs: options.timeoutMs ?? ASSISTANT_CLIENT_TIMEOUT_MS,
      retryOnUnauthorized: true,
    },
    isAssistantHelpResponse,
  );
}
