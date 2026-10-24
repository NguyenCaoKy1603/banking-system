import { isSelectionAllowed, type SelectionPolicy } from "./selectionPolicy.js";
import type { AISelectorOutput, FinancialOptionId, ReasonId } from "./types.js";

const MAX_SELECTOR_OUTPUT_CODE_POINTS = 2_000;

/** Scans JSON and detects duplicate decoded keys before materialization. */
class DuplicateKeyScanner {
  private index = 0;

  constructor(private readonly text: string) {}

  scan(): boolean {
    this.skipWhitespace();
    this.readValue(0);
    this.skipWhitespace();
    return this.index === this.text.length;
  }

  private skipWhitespace(): void {
    while (this.index < this.text.length && /[\u0009\u000a\u000d\u0020]/.test(this.text[this.index]!)) this.index += 1;
  }

  private readValue(depth: number): void {
    if (depth > 8) throw new Error("invalid-json");
    this.skipWhitespace();
    const current = this.text[this.index];
    if (current === "{") return this.readObject(depth + 1);
    if (current === "[") return this.readArray(depth + 1);
    if (current === '"') { this.readString(); return; }
    if (current === "t" && this.readLiteral("true")) return;
    if (current === "f" && this.readLiteral("false")) return;
    if (current === "n" && this.readLiteral("null")) return;
    const number = this.text.slice(this.index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (!number) throw new Error("invalid-json");
    this.index += number[0].length;
  }

  private readLiteral(literal: string): boolean {
    if (!this.text.startsWith(literal, this.index)) return false;
    this.index += literal.length;
    return true;
  }

  private readString(): string {
    const start = this.index;
    this.index += 1;
    while (this.index < this.text.length) {
      const char = this.text[this.index]!;
      if (char === '"') {
        this.index += 1;
        try { return JSON.parse(this.text.slice(start, this.index)) as string; }
        catch { throw new Error("invalid-json"); }
      }
      if (char === "\\") {
        this.index += 1;
        if (this.index >= this.text.length) throw new Error("invalid-json");
        if (this.text[this.index] === "u") {
          const hex = this.text.slice(this.index + 1, this.index + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Error("invalid-json");
          this.index += 5;
          continue;
        }
        if (!/["\\/bfnrt]/.test(this.text[this.index]!)) throw new Error("invalid-json");
        this.index += 1;
        continue;
      }
      if (char.charCodeAt(0) < 0x20) throw new Error("invalid-json");
      this.index += 1;
    }
    throw new Error("invalid-json");
  }

  private readObject(depth: number): void {
    this.index += 1;
    this.skipWhitespace();
    if (this.text[this.index] === "}") { this.index += 1; return; }
    const keys = new Set<string>();
    while (this.index < this.text.length) {
      this.skipWhitespace();
      if (this.text[this.index] !== '"') throw new Error("invalid-json");
      const key = this.readString();
      if (keys.has(key)) throw new Error("duplicate-key");
      keys.add(key);
      this.skipWhitespace();
      if (this.text[this.index] !== ":") throw new Error("invalid-json");
      this.index += 1;
      this.readValue(depth);
      this.skipWhitespace();
      const delimiter = this.text[this.index];
      if (delimiter === "}") { this.index += 1; return; }
      if (delimiter !== ",") throw new Error("invalid-json");
      this.index += 1;
    }
    throw new Error("invalid-json");
  }

  private readArray(depth: number): void {
    this.index += 1;
    this.skipWhitespace();
    if (this.text[this.index] === "]") { this.index += 1; return; }
    while (this.index < this.text.length) {
      this.readValue(depth);
      this.skipWhitespace();
      const delimiter = this.text[this.index];
      if (delimiter === "]") { this.index += 1; return; }
      if (delimiter !== ",") throw new Error("invalid-json");
      this.index += 1;
    }
    throw new Error("invalid-json");
  }
}

export class InvalidSelectorOutputError extends Error {
  constructor() {
    super("Provider selector output did not match the closed contract.");
    this.name = "InvalidSelectorOutputError";
  }
}

const OPTION_IDS = new Set<FinancialOptionId>([
  "MAINTAIN_PLAN", "GOAL_ALREADY_FUNDED", "EXTEND_DEADLINE",
  "REDUCE_FLEXIBLE_SPENDING", "LOWER_GOAL_AMOUNT", "REVIEW_BASE_BUDGET",
  "MAINTAIN_BUDGET", "ADJUST_SAVINGS_TARGET",
]);
const REASON_IDS = new Set<ReasonId>([
  "TARGET_ALREADY_FUNDED", "MONTHLY_GAP", "GOAL_FEASIBLE", "BUDGET_TARGET_MET",
  "BASE_BUDGET_DEFICIT", "BUFFER_NOT_COVERED", "NO_SAVING_CAPACITY",
  "PRESERVE_CURRENT_SPENDING", "KEEP_TARGET_WITH_FLEXIBLE_CUT",
  "ADJUST_GOAL_TO_CAPACITY", "EXTEND_TIME_TO_CAPACITY", "REVIEW_DECLARED_INPUTS",
]);

export function parseAISelectorSchema(rawText: string): AISelectorOutput {
  if (Array.from(rawText).length > MAX_SELECTOR_OUTPUT_CODE_POINTS) throw new InvalidSelectorOutputError();
  const trimmed = rawText.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) throw new InvalidSelectorOutputError();
  try {
    if (!new DuplicateKeyScanner(trimmed).scan()) throw new Error("invalid-json");
  } catch {
    throw new InvalidSelectorOutputError();
  }

  let parsed: unknown;
  try { parsed = JSON.parse(trimmed); }
  catch { throw new InvalidSelectorOutputError(); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new InvalidSelectorOutputError();
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).length !== 2 || !Object.hasOwn(record, "preferredOptionId") || !Object.hasOwn(record, "reasonIds")) {
    throw new InvalidSelectorOutputError();
  }
  const optionId = record.preferredOptionId;
  const rawReasons = record.reasonIds;
  if (typeof optionId !== "string" || !OPTION_IDS.has(optionId as FinancialOptionId) || !Array.isArray(rawReasons) || rawReasons.some((reason) => typeof reason !== "string" || !REASON_IDS.has(reason as ReasonId))) {
    throw new InvalidSelectorOutputError();
  }
  const reasonIds = rawReasons as string[];
  if (reasonIds.length < 1 || reasonIds.length > 3 || new Set(reasonIds).size !== reasonIds.length) {
    throw new InvalidSelectorOutputError();
  }
  return {
    preferredOptionId: optionId as FinancialOptionId,
    reasonIds: reasonIds as ReasonId[],
  };
}

export function parseStrictAIOutput(rawText: string, policy: SelectionPolicy): AISelectorOutput {
  const parsed = parseAISelectorSchema(rawText);
  if (!isSelectionAllowed(policy, parsed.preferredOptionId, parsed.reasonIds)) {
    throw new InvalidSelectorOutputError();
  }
  return parsed;
}
