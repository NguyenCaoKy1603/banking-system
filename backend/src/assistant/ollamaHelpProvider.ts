import type {
  AssistantHelpOutput,
  AssistantHelpProvider,
  FinishReason,
} from "./helpProvider.js";

export const SUPPORTED_OLLAMA_MODEL = "qwen3.5:4b";
export const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
export const DEFAULT_MAX_OLLAMA_RESPONSE_BYTES = 65_536; // 64 KiB limit

export function validateOllamaBaseUrl(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== "string") {
    throw new Error("Ollama base URL must be a non-empty string.");
  }
  const trimmed = rawUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid Ollama base URL format: ${rawUrl}`);
  }

  if (parsed.protocol !== "http:") {
    throw new Error(`Ollama base URL protocol must be http:, received: ${parsed.protocol}`);
  }

  // Hostname must strictly be 127.0.0.1
  if (parsed.hostname !== "127.0.0.1") {
    throw new Error(`Ollama base URL hostname must strictly be 127.0.0.1, received: ${parsed.hostname}`);
  }

  // Must not have credentials
  if (parsed.username || parsed.password) {
    throw new Error("Ollama base URL must not contain credentials (username or password).");
  }

  // Must not have query parameters
  if (parsed.search) {
    throw new Error("Ollama base URL must not contain query parameters.");
  }

  // Must not have hash fragment
  if (parsed.hash) {
    throw new Error("Ollama base URL must not contain hash fragments.");
  }

  // Check port
  const port = parsed.port ? Number(parsed.port) : 80;
  if (Number.isNaN(port) || port <= 0 || port > 65535) {
    throw new Error(`Ollama base URL port is invalid: ${parsed.port}`);
  }

  // Must not have custom pathname
  if (parsed.pathname !== "" && parsed.pathname !== "/") {
    throw new Error(`Ollama base URL must not contain custom paths, received: ${parsed.pathname}`);
  }

  return parsed.origin;
}

export function validateOllamaModel(model: string): string {
  if (!model || typeof model !== "string") {
    throw new Error("Ollama model must be a non-empty string.");
  }
  const trimmed = model.trim();
  if (trimmed.toLowerCase().includes("cloud")) {
    throw new Error(`Cloud models/tags are strictly forbidden: ${trimmed}`);
  }
  if (trimmed !== SUPPORTED_OLLAMA_MODEL) {
    throw new Error(
      `Unsupported Ollama model: '${trimmed}'. Only '${SUPPORTED_OLLAMA_MODEL}' is supported in this implementation.`,
    );
  }
  return trimmed;
}

export const DEFAULT_OLLAMA_NUM_PREDICT = 530;

export type OllamaProviderOptions = {
  baseUrl?: string;
  model?: string;
  maxResponseBytes?: number;
  numPredict?: number;
};

async function readResponseBodyWithLimit(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<string> {
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      if (signal?.aborted) {
        const err = new Error("Provider call aborted by client signal.");
        err.name = "AbortError";
        throw err;
      }

      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          try {
            await reader.cancel();
          } catch {
            // Ignore cancel error on stream release
          }
          throw new Error(`Ollama response exceeded maximum allowed bytes (${maxBytes}).`);
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(combined);
}

export class OllamaAssistantHelpProvider implements AssistantHelpProvider {
  readonly baseUrl: string;
  readonly model: string;
  readonly maxResponseBytes: number;
  readonly numPredict: number;
  private readonly chatEndpoint: string;

  constructor(options: OllamaProviderOptions = {}) {
    this.baseUrl = validateOllamaBaseUrl(options.baseUrl ?? DEFAULT_OLLAMA_BASE_URL);
    this.model = validateOllamaModel(options.model ?? SUPPORTED_OLLAMA_MODEL);
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_OLLAMA_RESPONSE_BYTES;
    const rawNumPredict = options.numPredict ?? DEFAULT_OLLAMA_NUM_PREDICT;
    if (!Number.isSafeInteger(rawNumPredict) || rawNumPredict <= 0) {
      throw new Error(`Ollama numPredict must be a positive integer, received: ${options.numPredict}`);
    }
    this.numPredict = rawNumPredict;
    this.chatEndpoint = `${this.baseUrl}/api/chat`;
  }

  async generateHelpResponse(
    prompt: string,
    knowledgeContext: string,
    question: string,
    signal?: AbortSignal,
  ): Promise<AssistantHelpOutput> {
    if (signal?.aborted) {
      const err = new Error("Provider call aborted by client signal.");
      err.name = "AbortError";
      throw err;
    }

    const payload = {
      model: this.model,
      stream: false,
      think: false,
      messages: [
        {
          role: "system",
          content: prompt,
        },
        {
          role: "system",
          content: knowledgeContext,
        },
        {
          role: "user",
          content: question,
        },
      ],
      options: {
        temperature: 0.1,
        num_ctx: 8192,
        num_predict: this.numPredict,
      },
    };

    let response: Response;
    try {
      response = await fetch(this.chatEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        redirect: "error",
        signal,
      });
    } catch (fetchError: unknown) {
      if (signal?.aborted) {
        const err = new Error("Provider call aborted by client signal.");
        err.name = "AbortError";
        throw err;
      }
      throw fetchError;
    }

    if (!response.ok) {
      throw new Error(`Ollama provider responded with HTTP status ${response.status}`);
    }

    const rawJson = await readResponseBodyWithLimit(response, this.maxResponseBytes, signal);

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      throw new Error("Failed to parse Ollama response as JSON.");
    }

    if (!parsed || typeof parsed !== "object") {
      throw new Error("Ollama response must be a JSON object.");
    }

    const obj = parsed as Record<string, unknown>;

    // Fail-closed checks on message
    const msg = obj.message;
    if (!msg || typeof msg !== "object") {
      throw new Error("Ollama response missing message object.");
    }

    const msgObj = msg as Record<string, unknown>;
    const toolCalls = msgObj.tool_calls;
    const hasToolCalls = Array.isArray(toolCalls) && toolCalls.length > 0;

    if (typeof msgObj.content !== "string") {
      throw new Error("Ollama message content must be a string.");
    }

    // Map finishReason
    let finishReason: FinishReason;
    if (hasToolCalls) {
      finishReason = "tool_calls";
    } else if (obj.done !== true) {
      finishReason = "unknown";
    } else if (obj.done_reason === "stop") {
      finishReason = "stop";
    } else if (obj.done_reason === "length") {
      finishReason = "length";
    } else {
      finishReason = "unknown";
    }

    return {
      text: msgObj.content,
      finishReason,
      toolCallsDetected: hasToolCalls,
    };
  }
}
