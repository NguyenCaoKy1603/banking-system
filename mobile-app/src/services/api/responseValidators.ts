export function isNonEmptyDateTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.includes("T") &&
    !Number.isNaN(Date.parse(value))
  );
}
