const SENSITIVE_KEYS = /password|token|otp|totp|secret|cookie|cvv|pin|database.?url|encryption.?key|account.?number/i;

export function redactAdminMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactAdminMetadata);
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SENSITIVE_KEYS.test(key) ? "[REDACTED]" : redactAdminMetadata(item);
    }
    return output;
  }
  if (typeof value === "string" && SENSITIVE_KEYS.test(value)) return "[REDACTED]";
  return value;
}

export function maskAccountNumber(accountNumber: string): string {
  const normalized = accountNumber.replace(/\D/g, "");
  if (normalized.length <= 4) return `•••• ${normalized}`;
  return `•••• ${normalized.slice(-4)}`;
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@", 2);
  if (!domain) return "[REDACTED_EMAIL]";
  const visible = local.slice(0, 1);
  return `${visible}${local.length > 1 ? "***" : ""}@${domain}`;
}

export function maskPhone(phone: string): string {
  const normalized = phone.replace(/\D/g, "");
  if (normalized.length <= 2) return "••••";
  return `••••••${normalized.slice(-2)}`;
}
