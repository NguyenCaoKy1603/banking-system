import crypto from "node:crypto";
import { DomainError } from "../errors.js";
import {
  PROMPT_VERSION,
  PROMPT_HASH,
  SYSTEM_PROMPT,
  FAQ_VERSION,
  FAQ_HASH,
  FAQ_PART_A,
  FAQ_ITEM_IDS,
} from "./knowledgeBundle.js";

export type LoadedKnowledge = {
  systemPrompt: string;
  promptVersion: string;
  promptHash: string;
  faqPartA: string;
  faqVersion: string;
  faqHash: string;
  faqItemIds: readonly string[];
};

export function validateKnowledge(
  prompt: string,
  promptVersion: string,
  faqPartA: string,
  faqVersion: string,
  faqItemIds: readonly string[],
): void {
  if (!prompt || !prompt.trim()) {
    throw new DomainError(503, "ASSISTANT_UNAVAILABLE", "Assistant system prompt is missing or empty.");
  }
  if (!promptVersion || !promptVersion.trim()) {
    throw new DomainError(503, "ASSISTANT_UNAVAILABLE", "Assistant prompt version is not defined.");
  }
  if (!faqPartA || !faqPartA.trim()) {
    throw new DomainError(503, "ASSISTANT_UNAVAILABLE", "Assistant FAQ knowledge is missing or empty.");
  }
  if (!faqVersion || !faqVersion.trim()) {
    throw new DomainError(503, "ASSISTANT_UNAVAILABLE", "Assistant FAQ version is not defined.");
  }

  if (faqItemIds.length !== 20) {
    throw new DomainError(503, "ASSISTANT_UNAVAILABLE", `Assistant FAQ must contain exactly 20 items; found ${faqItemIds.length}.`);
  }

  const unique = new Set(faqItemIds);
  if (unique.size !== 20) {
    throw new DomainError(503, "ASSISTANT_UNAVAILABLE", "Assistant FAQ contains duplicate item IDs.");
  }

  for (let i = 1; i <= 20; i++) {
    const expected = `FAQ-${String(i).padStart(2, "0")}`;
    if (!unique.has(expected)) {
      throw new DomainError(503, "ASSISTANT_UNAVAILABLE", `Assistant FAQ is missing item ${expected}.`);
    }
  }

  // Ensure no forbidden developer/test sections exist in Part A
  if (faqPartA.includes("## Phần B") || faqPartA.includes("## Phần C") || faqPartA.includes("## Phần D")) {
    throw new DomainError(503, "ASSISTANT_UNAVAILABLE", "Assistant FAQ context contains unauthorized developer sections.");
  }
}

export type KnowledgeBundleOverrides = {
  systemPrompt?: string;
  promptVersion?: string;
  promptHash?: string;
  faqPartA?: string;
  faqVersion?: string;
  faqHash?: string;
  faqItemIds?: readonly string[];
};

export function loadKnowledge(overrides?: KnowledgeBundleOverrides): LoadedKnowledge {
  const prompt = overrides?.systemPrompt ?? SYSTEM_PROMPT;
  const promptVersion = overrides?.promptVersion ?? PROMPT_VERSION;
  const promptHash = overrides?.promptHash ?? PROMPT_HASH;
  const faqPartA = overrides?.faqPartA ?? FAQ_PART_A;
  const faqVersion = overrides?.faqVersion ?? FAQ_VERSION;
  const faqHash = overrides?.faqHash ?? FAQ_HASH;
  const faqItemIds = overrides?.faqItemIds ?? FAQ_ITEM_IDS;

  validateKnowledge(prompt, promptVersion, faqPartA, faqVersion, faqItemIds);

  const calculatedPromptHash = crypto.createHash("sha256").update(prompt, "utf8").digest("hex");
  const calculatedFaqHash = crypto.createHash("sha256").update(faqPartA, "utf8").digest("hex");

  if (calculatedPromptHash !== promptHash) {
    throw new DomainError(503, "ASSISTANT_UNAVAILABLE", "Assistant system prompt checksum mismatch with bundle constant.");
  }
  if (calculatedFaqHash !== faqHash) {
    throw new DomainError(503, "ASSISTANT_UNAVAILABLE", "Assistant FAQ checksum mismatch with bundle constant.");
  }

  return {
    systemPrompt: prompt,
    promptVersion,
    promptHash: calculatedPromptHash,
    faqPartA,
    faqVersion,
    faqHash: calculatedFaqHash,
    faqItemIds,
  };
}
