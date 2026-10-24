import * as Crypto from "expo-crypto";

import {
  COMMAND_IDEMPOTENCY_KEY_MIN_LENGTH,
  GENERAL_IDEMPOTENCY_KEY_MIN_LENGTH,
  createIdempotencyKey,
  requireIdempotencyKey,
} from "@/features/banking/validation/idempotencyKey";

jest.mock("expo-crypto", () => ({ randomUUID: jest.fn() }));

const randomUUIDMock = jest.mocked(Crypto.randomUUID);

beforeEach(() => {
  randomUUIDMock.mockReset();
  randomUUIDMock.mockReturnValue("00000000-0000-4000-8000-000000000001");
});

describe("requireIdempotencyKey", () => {
  it("normalizes keys that meet the endpoint boundary", () => {
    expect(
      requireIdempotencyKey(
        "  transfer-intent-1  ",
        COMMAND_IDEMPOTENCY_KEY_MIN_LENGTH,
      ),
    ).toBe("transfer-intent-1");
    expect(
      requireIdempotencyKey("command-01", GENERAL_IDEMPOTENCY_KEY_MIN_LENGTH),
    ).toBe("command-01");
  });

  it("rejects keys shorter than the endpoint boundary", () => {
    expect(() =>
      requireIdempotencyKey("short", COMMAND_IDEMPOTENCY_KEY_MIN_LENGTH),
    ).toThrow("idempotencyKey phải có ít nhất 16 ký tự.");
    expect(() =>
      requireIdempotencyKey("short", GENERAL_IDEMPOTENCY_KEY_MIN_LENGTH),
    ).toThrow("idempotencyKey phải có ít nhất 8 ký tự.");
  });

  it("creates collision-resistant namespaced keys", () => {
    expect(createIdempotencyKey("credit-application")).toBe(
      "credit-application-00000000-0000-4000-8000-000000000001",
    );
    expect(randomUUIDMock).toHaveBeenCalledTimes(1);
  });
});
