export type FinishReason =
  | "stop"
  | "length"
  | "tool_calls"
  | "content_filter"
  | "error"
  | "unknown";

export type AssistantHelpOutput = {
  text: string;
  finishReason: FinishReason;
  toolCallsDetected?: boolean;
};

export interface AssistantHelpProvider {
  generateHelpResponse(
    prompt: string,
    knowledgeContext: string,
    question: string,
    signal?: AbortSignal,
  ): Promise<AssistantHelpOutput>;
}

export type FakeProviderMode =
  | "success"
  | "empty"
  | "invalid_type"
  | "error"
  | "timeout_hang"
  | "truncated_or_oversized"
  | "tool_call_request"
  | "spy_recorder";

export type FakeProviderOptions = {
  mode?: FakeProviderMode;
  defaultAnswer?: string;
  errorToThrow?: Error;
  hangDelayMs?: number;
  invalidPayload?: unknown;
  oversizedText?: string;
  innerProvider?: AssistantHelpProvider;
  customOutput?: unknown;
  ignoreAbortSignal?: boolean;
};

export class FakeAssistantHelpProvider implements AssistantHelpProvider {
  private mode: FakeProviderMode;
  private defaultAnswer: string;
  private errorToThrow?: Error;
  private hangDelayMs: number;
  private invalidPayload?: unknown;
  private oversizedText?: string;
  private innerProvider?: AssistantHelpProvider;
  private customOutput?: unknown;
  private ignoreAbortSignal?: boolean;

  public callCount = 0;
  public calls: Array<{
    prompt: string;
    knowledgeContext: string;
    question: string;
    aborted?: boolean;
  }> = [];

  constructor(options: FakeProviderOptions = {}) {
    this.mode = options.mode ?? "success";
    this.defaultAnswer = options.defaultAnswer ?? '{"selectionId":"FAQ-04"}';
    this.errorToThrow = options.errorToThrow;
    this.hangDelayMs = options.hangDelayMs ?? 60_000;
    this.invalidPayload = options.invalidPayload;
    this.oversizedText = options.oversizedText;
    this.innerProvider = options.innerProvider;
    this.customOutput = options.customOutput;
    this.ignoreAbortSignal = options.ignoreAbortSignal;
  }

  setMode(mode: FakeProviderMode, options: Partial<FakeProviderOptions> = {}): void {
    this.mode = mode;
    if (options.defaultAnswer !== undefined) this.defaultAnswer = options.defaultAnswer;
    if (options.errorToThrow !== undefined) this.errorToThrow = options.errorToThrow;
    if (options.hangDelayMs !== undefined) this.hangDelayMs = options.hangDelayMs;
    if (options.invalidPayload !== undefined) this.invalidPayload = options.invalidPayload;
    if (options.oversizedText !== undefined) this.oversizedText = options.oversizedText;
    if (options.innerProvider !== undefined) this.innerProvider = options.innerProvider;
    if (options.customOutput !== undefined) this.customOutput = options.customOutput;
    if (options.ignoreAbortSignal !== undefined) this.ignoreAbortSignal = options.ignoreAbortSignal;
  }

  setHangDelay(delayMs: number): void {
    this.hangDelayMs = delayMs;
  }

  setIgnoreAbortSignal(ignore: boolean): void {
    this.ignoreAbortSignal = ignore;
  }

  setCustomOutput(output: unknown): void {
    this.customOutput = output;
  }

  reset(): void {
    this.callCount = 0;
    this.calls = [];
  }

  async generateHelpResponse(
    prompt: string,
    knowledgeContext: string,
    question: string,
    signal?: AbortSignal,
  ): Promise<AssistantHelpOutput> {
    this.callCount++;
    const callRecord = {
      prompt,
      knowledgeContext,
      question,
      aborted: signal?.aborted,
    };
    this.calls.push(callRecord);

    if (signal?.aborted) {
      const err = new Error("Provider call aborted by client signal.");
      err.name = "AbortError";
      throw err;
    }

    if (this.customOutput !== undefined) {
      return this.customOutput as AssistantHelpOutput;
    }

    switch (this.mode) {
      case "success":
        return {
          text: this.defaultAnswer,
          finishReason: "stop",
          toolCallsDetected: false,
        };

      case "empty":
        return {
          text: "",
          finishReason: "stop",
          toolCallsDetected: false,
        };

      case "invalid_type":
        // Trả về đối tượng không đúng schema của AssistantHelpOutput
        return (this.invalidPayload ?? { text: 12345, finishReason: null }) as unknown as AssistantHelpOutput;

      case "error":
        throw this.errorToThrow ?? new Error("Simulated fake provider internal failure.");

      case "timeout_hang":
        return new Promise<AssistantHelpOutput>((resolve, reject) => {
          const timer = setTimeout(() => {
            resolve({
              text: this.defaultAnswer,
              finishReason: "stop",
            });
          }, this.hangDelayMs);
          timer.unref();

          if (signal && !this.ignoreAbortSignal) {
            signal.addEventListener("abort", () => {
              clearTimeout(timer);
              callRecord.aborted = true;
              const err = new Error("Provider request aborted by timeout/signal.");
              err.name = "AbortError";
              reject(err);
            });
          }
        });

      case "truncated_or_oversized":
        if (this.oversizedText) {
          return {
            text: this.oversizedText,
            finishReason: "stop",
            toolCallsDetected: false,
          };
        }
        return {
          text: "Câu trả lời bị cắt giữa chừng vì vượt trần t...",
          finishReason: "length",
          toolCallsDetected: false,
        };

      case "tool_call_request":
        return {
          text: "Gọi hàm get_balance()",
          finishReason: "tool_calls",
          toolCallsDetected: true,
        };

      case "spy_recorder":
        if (this.innerProvider) {
          return this.innerProvider.generateHelpResponse(prompt, knowledgeContext, question, signal);
        }
        return {
          text: this.defaultAnswer,
          finishReason: "stop",
          toolCallsDetected: false,
        };

      default:
        return {
          text: this.defaultAnswer,
          finishReason: "stop",
        };
    }
  }
}
