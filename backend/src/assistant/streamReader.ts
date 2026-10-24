import type { IncomingMessage } from "node:http";
import { invalidRequest } from "../errors.js";

export type ValidatedQuestion = {
  question: string;
  codePoints: number;
};

export async function readAssistantBody(
  request: IncomingMessage,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) {
    throw new Error("Request aborted before reading body.");
  }

  return new Promise<string>((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    let finished = false;

    const onAbort = () => {
      if (finished) return;
      finished = true;
      cleanup();
      request.resume();
      reject(new Error("Request aborted during body stream read."));
    };

    const onData = (chunk: unknown) => {
      if (finished) return;
      if (signal?.aborted) {
        onAbort();
        return;
      }
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBuffer);
      size += buffer.length;
      if (size > maxBytes) {
        finished = true;
        cleanup();
        request.resume();
        reject(invalidRequest("Request body exceeds maximum size."));
        return;
      }
      chunks.push(buffer);
    };

    const onEnd = () => {
      if (finished) return;
      finished = true;
      cleanup();
      resolve(Buffer.concat(chunks).toString("utf8"));
    };

    const onError = (err: Error) => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(err);
    };

    function cleanup() {
      request.removeListener("data", onData);
      request.removeListener("end", onEnd);
      request.removeListener("error", onError);
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
    }

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    request.on("data", onData);
    request.on("end", onEnd);
    request.on("error", onError);
  });
}

export function parseAndValidateAssistantPayload(
  rawBody: string,
  maxCodePoints: number,
): ValidatedQuestion {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw invalidRequest("Request body must be valid JSON.");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw invalidRequest("Request body must be a JSON object.");
  }

  const obj = parsed as Record<string, unknown>;
  const keys = Object.keys(obj);

  // Chỉ cho phép duy nhất trường 'question'
  const unexpected = keys.filter((k) => k !== "question");
  if (unexpected.length > 0) {
    throw invalidRequest("Request body contains unexpected fields; only 'question' is allowed.");
  }

  if (!("question" in obj) || obj.question === undefined || obj.question === null) {
    throw invalidRequest("question is required.");
  }

  if (typeof obj.question !== "string") {
    throw invalidRequest("question must be a string.");
  }

  // Chuẩn hóa NFC và trim khoảng trắng
  const normalized = obj.question.normalize("NFC").trim();
  if (normalized.length === 0) {
    throw invalidRequest("question is required.");
  }

  // Đếm Unicode code points chính xác
  const codePoints = Array.from(normalized).length;
  if (codePoints > maxCodePoints) {
    throw invalidRequest(`question must be at most ${maxCodePoints} characters.`);
  }

  return {
    question: normalized,
    codePoints,
  };
}
