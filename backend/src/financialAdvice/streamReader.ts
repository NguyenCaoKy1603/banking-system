import type { IncomingMessage } from "node:http";
import { DomainError } from "../errors.js";

export async function readFinancialAdviceBody(
  request: IncomingMessage,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) {
    const err = new Error("Request aborted before reading body.");
    err.name = "AbortError";
    throw err;
  }

  return new Promise<string>((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    let finished = false;

    const cleanup = () => {
      request.removeListener("data", onData);
      request.removeListener("end", onEnd);
      request.removeListener("error", onError);
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
    };

    const onAbort = () => {
      if (finished) return;
      finished = true;
      cleanup();
      request.resume();
      const err = new Error("Request aborted during body stream read.");
      err.name = "AbortError";
      reject(err);
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
        reject(
          new DomainError(
            413,
            "FINANCIAL_ADVICE_BODY_TOO_LARGE",
            `Request body exceeds maximum allowable size (${maxBytes} bytes).`,
          ),
        );
        return;
      }
      chunks.push(buffer);
    };

    const onEnd = () => {
      if (finished) return;
      finished = true;
      cleanup();
      resolve(Buffer.concat(chunks).toString("utf-8"));
    };

    const onError = (err: unknown) => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(err);
    };

    request.on("data", onData);
    request.on("end", onEnd);
    request.on("error", onError);
    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}
