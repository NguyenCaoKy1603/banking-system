export class MockServiceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "MockServiceError";
    this.code = code;
  }
}

export function requireMockUserId(userId: string): string {
  const normalized = userId.trim();
  if (!normalized) {
    throw new MockServiceError("UNAUTHORIZED", "Phiên đăng nhập không hợp lệ.");
  }
  return normalized;
}

export function requireMockId(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new MockServiceError("VALIDATION_ERROR", `${fieldName} không được để trống.`);
  }
  return normalized;
}

export function requirePositiveMinor(value: string, fieldName: string): bigint {
  const normalized = value.trim();
  if (!/^[1-9][0-9]*$/.test(normalized)) {
    throw new MockServiceError(
      "VALIDATION_ERROR",
      `${fieldName} phải là số nguyên dương.`,
    );
  }
  return BigInt(normalized);
}

export function requireMockText(
  value: string,
  fieldName: string,
  minLength = 1,
): string {
  const normalized = value.trim();
  if (normalized.length < minLength) {
    throw new MockServiceError(
      "VALIDATION_ERROR",
      `${fieldName} phải có ít nhất ${minLength} ký tự.`,
    );
  }
  return normalized;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function addMonthsIso(value: string, months: number): string {
  const date = new Date(value);
  date.setMonth(date.getMonth() + months);
  return date.toISOString();
}
