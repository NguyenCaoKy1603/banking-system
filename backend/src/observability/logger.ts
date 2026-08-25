type LogLevel = "debug" | "info" | "warn" | "error";

const REDACTED = "[REDACTED]";
const SENSITIVE_KEY = /(password|passcode|secret|token|authorization|cookie|otp|totp|pin|cvv|device.?secret|refresh|access.?token|private.?key|ciphertext)/i;

function safeValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[TRUNCATED]";
  if (typeof value === "string") return value.length > 512 ? `${value.slice(0, 512)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => safeValue(item, depth + 1));
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value).slice(0, 50)) {
      result[key] = SENSITIVE_KEY.test(key) ? REDACTED : safeValue(entry, depth + 1);
    }
    return result;
  }
  return value;
}

export type StructuredLogFields = Record<string, unknown>;

export type StructuredLogger = {
  log(level: LogLevel, event: string, fields?: StructuredLogFields): void;
};

/** JSON logger for local preview; enabled explicitly with BANKING_STRUCTURED_LOGS=1. */
export function createStructuredLogger(options: { enabled?: boolean; service?: string } = {}): StructuredLogger {
  const enabled = options.enabled ?? process.env.BANKING_STRUCTURED_LOGS === "1";
  const service = options.service ?? "banking-reference-backend";
  return {
    log(level, event, fields = {}) {
      if (!enabled) return;
      const record = {
        timestamp: new Date().toISOString(),
        level,
        service,
        event,
        ...safeValue(fields) as Record<string, unknown>,
      };
      process.stderr.write(`${JSON.stringify(record)}\n`);
    },
  };
}

export function redactForLog(value: unknown): unknown {
  return safeValue(value);
}

