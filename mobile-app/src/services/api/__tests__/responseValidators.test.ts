import { isNonEmptyDateTime } from "@/services/api/responseValidators";

describe("responseValidators", () => {
  it("chấp nhận timestamp có thể parse được", () => {
    expect(isNonEmptyDateTime("2026-08-14T00:00:00Z")).toBe(true);
  });

  it.each(["", "not-a-date", "2026-08-14", null, 0])(
    "từ chối timestamp không hợp lệ: %s",
    (value) => {
      expect(isNonEmptyDateTime(value)).toBe(false);
    },
  );
});
