import type {
  AssistantHelpOutput,
  AssistantHelpProvider,
  FinishReason,
} from "./helpProvider.js";

export const DEFAULT_RADOX_MODEL = "gemini-3.6-flash";
export const DEFAULT_RADOX_BASE_URL = "https://radoxai.com/v1";
export const DEFAULT_MAX_RADOX_RESPONSE_BYTES = 65_536; // 64 KiB limit
export const DEFAULT_RADOX_MAX_TOKENS = 1000;

export function validateRadoxBaseUrl(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== "string") {
    throw new Error("Radox base URL must be a non-empty string.");
  }
  const trimmed = rawUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid Radox base URL format: ${rawUrl}`);
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`Radox base URL protocol must be https: or http:, received: ${parsed.protocol}`);
  }

  // Must not have credentials
  if (parsed.username || parsed.password) {
    throw new Error("Radox base URL must not contain credentials (username or password).");
  }

  // Must not have query parameters
  if (parsed.search) {
    throw new Error("Radox base URL must not contain query parameters.");
  }

  // Must not have hash fragment
  if (parsed.hash) {
    throw new Error("Radox base URL must not contain hash fragments.");
  }

  // Clean trailing slash
  return parsed.origin + parsed.pathname.replace(/\/+$/, "");
}

export function validateRadoxApiKey(key: string): string {
  if (!key || typeof key !== "string" || key.trim() === "") {
    throw new Error("Radox API key must be a non-empty string.");
  }
  return key.trim();
}

export function validateRadoxModel(model: string): string {
  if (!model || typeof model !== "string" || model.trim() === "") {
    throw new Error("Radox model must be a non-empty string.");
  }
  return model.trim();
}

export type RadoxProviderOptions = {
  baseUrl?: string;
  apiKey: string;
  model?: string;
  maxResponseBytes?: number;
  maxTokens?: number;
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
          throw new Error(`Radox response exceeded maximum allowed bytes (${maxBytes}).`);
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

export class RadoxAssistantHelpProvider implements AssistantHelpProvider {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly maxResponseBytes: number;
  readonly maxTokens: number;
  private readonly chatEndpoint: string;

  constructor(options: RadoxProviderOptions) {
    this.baseUrl = validateRadoxBaseUrl(options.baseUrl ?? DEFAULT_RADOX_BASE_URL);
    this.apiKey = validateRadoxApiKey(options.apiKey);
    this.model = validateRadoxModel(options.model ?? DEFAULT_RADOX_MODEL);
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RADOX_RESPONSE_BYTES;
    const rawMaxTokens = options.maxTokens ?? DEFAULT_RADOX_MAX_TOKENS;
    if (!Number.isSafeInteger(rawMaxTokens) || rawMaxTokens <= 0) {
      throw new Error(`Radox maxTokens must be a positive integer, received: ${options.maxTokens}`);
    }
    this.maxTokens = rawMaxTokens;
    this.chatEndpoint = `${this.baseUrl}/chat/completions`;
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

    const systemContent = knowledgeContext
      ? `${prompt}\n\n${knowledgeContext}`.trim()
      : prompt.trim();

    const payload = {
      model: this.model,
      stream: false,
      messages: [
        {
          role: "system",
          content: systemContent,
        },
        {
          role: "user",
          content: question,
        },
      ],
      temperature: 0.1,
      max_tokens: this.maxTokens,
    };

    let response: Response;
    try {
      response = await fetch(this.chatEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`,
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
      throw new Error(`Radox provider responded with HTTP status ${response.status}`);
    }

    const rawJson = await readResponseBodyWithLimit(response, this.maxResponseBytes, signal);

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      throw new Error("Failed to parse Radox response as JSON.");
    }

    if (!parsed || typeof parsed !== "object") {
      throw new Error("Radox response must be a JSON object.");
    }

    const obj = parsed as Record<string, unknown>;

    // OpenAI Chat Completion schema validation
    const choices = obj.choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      throw new Error("Radox response missing choices array.");
    }

    const firstChoice = choices[0];
    if (!firstChoice || typeof firstChoice !== "object") {
      throw new Error("Radox response first choice is invalid.");
    }

    const choiceObj = firstChoice as Record<string, unknown>;
    const msg = choiceObj.message;
    if (!msg || typeof msg !== "object") {
      throw new Error("Radox response missing message object in choice.");
    }

    const msgObj = msg as Record<string, unknown>;
    const toolCalls = msgObj.tool_calls;
    const hasToolCalls = Array.isArray(toolCalls) && toolCalls.length > 0;

    const content = typeof msgObj.content === "string" ? msgObj.content : "";

    // Map finishReason
    let finishReason: FinishReason;
    const rawFinishReason = choiceObj.finish_reason;
    if (hasToolCalls) {
      finishReason = "tool_calls";
    } else if (rawFinishReason === "stop") {
      finishReason = "stop";
    } else if (rawFinishReason === "length") {
      finishReason = "length";
    } else if (rawFinishReason === "content_filter") {
      finishReason = "content_filter";
    } else {
      finishReason = "unknown";
    }

    return {
      text: content,
      finishReason,
      toolCallsDetected: hasToolCalls,
    };
  }
}
