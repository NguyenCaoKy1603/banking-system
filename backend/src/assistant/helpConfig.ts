import type { AssistantHelpProvider } from "./helpProvider.js";

export type AssistantConfig = {
  enabled: boolean;
  provider?: AssistantHelpProvider;
  maxBodyBytes: number;
  maxQuestionCodePoints: number;
  maxAnswerCodePoints: number;
  requestTimeoutMs: number;
  providerTimeoutMs: number;
  rateLimitPerMinute: number;
  maxConcurrentRequests: number;
  maxConcurrentPerUser: number;
};

export const DEFAULT_ASSISTANT_FIXTURE_CONFIG: Omit<AssistantConfig, "enabled" | "provider"> = {
  maxBodyBytes: 8192,
  maxQuestionCodePoints: 500,
  maxAnswerCodePoints: 2000,
  requestTimeoutMs: 12_000,
  providerTimeoutMs: 10_000,
  rateLimitPerMinute: 5,
  maxConcurrentRequests: 2,
  maxConcurrentPerUser: 1,
};

export function resolveAssistantConfig(partial?: Partial<AssistantConfig>): AssistantConfig {
  const envEnabled = process.env.ASSISTANT_ENABLED === "1";
  return {
    enabled: partial?.enabled ?? envEnabled,
    provider: partial?.provider,
    maxBodyBytes: partial?.maxBodyBytes ?? DEFAULT_ASSISTANT_FIXTURE_CONFIG.maxBodyBytes,
    maxQuestionCodePoints: partial?.maxQuestionCodePoints ?? DEFAULT_ASSISTANT_FIXTURE_CONFIG.maxQuestionCodePoints,
    maxAnswerCodePoints: partial?.maxAnswerCodePoints ?? DEFAULT_ASSISTANT_FIXTURE_CONFIG.maxAnswerCodePoints,
    requestTimeoutMs: partial?.requestTimeoutMs ?? DEFAULT_ASSISTANT_FIXTURE_CONFIG.requestTimeoutMs,
    providerTimeoutMs: partial?.providerTimeoutMs ?? DEFAULT_ASSISTANT_FIXTURE_CONFIG.providerTimeoutMs,
    rateLimitPerMinute: partial?.rateLimitPerMinute ?? DEFAULT_ASSISTANT_FIXTURE_CONFIG.rateLimitPerMinute,
    maxConcurrentRequests: partial?.maxConcurrentRequests ?? DEFAULT_ASSISTANT_FIXTURE_CONFIG.maxConcurrentRequests,
    maxConcurrentPerUser: partial?.maxConcurrentPerUser ?? DEFAULT_ASSISTANT_FIXTURE_CONFIG.maxConcurrentPerUser,
  };
}
