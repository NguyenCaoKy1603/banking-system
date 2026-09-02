import * as SecureStore from "expo-secure-store";

import {
  deleteRegistrationSession,
  loadRegistrationSession,
  saveRegistrationSession,
  type RegistrationSessionV1,
} from "@/features/auth/storage/registrationSessionStorage";

jest.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  deleteItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));

const getItemAsyncMock = jest.mocked(SecureStore.getItemAsync);
const setItemAsyncMock = jest.mocked(SecureStore.setItemAsync);
const deleteItemAsyncMock = jest.mocked(SecureStore.deleteItemAsync);

const REGISTRATION_SESSION_KEY = "banking.registration.session.v1";
const SECURE_STORE_OPTIONS = { keychainAccessible: 1 };

const validBeginUnknown: RegistrationSessionV1 = {
  schemaVersion: 1,
  phase: "BEGIN_UNKNOWN",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const validChallengeReceived: RegistrationSessionV1 = {
  schemaVersion: 1,
  phase: "CHALLENGE_RECEIVED",
  challengeId: "challenge-abc-123",
  methods: ["EMAIL_OTP"],
  purpose: "REGISTRATION_EMAIL_VERIFY",
  expiresAt: "2030-01-01T00:05:00.000Z",
  resendAfter: "2026-01-01T00:01:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  jest.clearAllMocks();
  setItemAsyncMock.mockResolvedValue(undefined);
  deleteItemAsyncMock.mockResolvedValue(undefined);
});

// ─── S1: load returns EMPTY when key is absent ────────────────────────────────
describe("S1 – loadRegistrationSession: EMPTY when absent", () => {
  it("returns { kind: 'EMPTY' } when SecureStore has no key", async () => {
    getItemAsyncMock.mockResolvedValue(null);
    const result = await loadRegistrationSession();
    expect(result).toEqual({ kind: "EMPTY" });
    expect(getItemAsyncMock).toHaveBeenCalledWith(
      REGISTRATION_SESSION_KEY,
      SECURE_STORE_OPTIONS,
    );
  });
});

// ─── S2: load returns VALID for BEGIN_UNKNOWN ─────────────────────────────────
describe("S2 – loadRegistrationSession: VALID BEGIN_UNKNOWN", () => {
  it("returns { kind: 'VALID', session } for valid BEGIN_UNKNOWN JSON", async () => {
    getItemAsyncMock.mockResolvedValue(JSON.stringify(validBeginUnknown));
    const result = await loadRegistrationSession();
    expect(result.kind).toBe("VALID");
    if (result.kind === "VALID") {
      expect(result.session.phase).toBe("BEGIN_UNKNOWN");
      expect(result.session.schemaVersion).toBe(1);
    }
  });
});

// ─── S3: load returns VALID for CHALLENGE_RECEIVED ───────────────────────────
describe("S3 – loadRegistrationSession: VALID CHALLENGE_RECEIVED", () => {
  it("returns { kind: 'VALID', session } for valid CHALLENGE_RECEIVED JSON", async () => {
    getItemAsyncMock.mockResolvedValue(JSON.stringify(validChallengeReceived));
    const result = await loadRegistrationSession();
    expect(result.kind).toBe("VALID");
    if (result.kind === "VALID" && result.session.phase === "CHALLENGE_RECEIVED") {
      expect(result.session.challengeId).toBe("challenge-abc-123");
      expect(result.session.methods).toEqual(["EMAIL_OTP"]);
      expect(result.session.purpose).toBe("REGISTRATION_EMAIL_VERIFY");
      expect(result.session.resendAfter).toBe("2026-01-01T00:01:00.000Z");
    }
  });

  it("accepts CHALLENGE_RECEIVED without optional resendAfter", async () => {
    const noResend: RegistrationSessionV1 = {
      schemaVersion: 1,
      phase: "CHALLENGE_RECEIVED",
      challengeId: "challenge-no-resend",
      methods: ["EMAIL_OTP"],
      purpose: "REGISTRATION_EMAIL_VERIFY",
      expiresAt: "2030-01-01T00:05:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    getItemAsyncMock.mockResolvedValue(JSON.stringify(noResend));
    const result = await loadRegistrationSession();
    expect(result.kind).toBe("VALID");
  });
});

// ─── S4: load returns CORRUPT for invalid JSON ────────────────────────────────
describe("S4 – loadRegistrationSession: CORRUPT on invalid JSON", () => {
  it("returns { kind: 'CORRUPT' } for malformed JSON", async () => {
    getItemAsyncMock.mockResolvedValue("not-valid-json{{{");
    const result = await loadRegistrationSession();
    expect(result).toEqual({ kind: "CORRUPT" });
  });

  it("returns { kind: 'CORRUPT' } for schema mismatch (wrong phase)", async () => {
    getItemAsyncMock.mockResolvedValue(
      JSON.stringify({ schemaVersion: 1, phase: "WRONG_PHASE", createdAt: "2026-01-01T00:00:00.000Z" }),
    );
    const result = await loadRegistrationSession();
    expect(result).toEqual({ kind: "CORRUPT" });
  });

  it("returns { kind: 'CORRUPT' } for singular method field instead of array", async () => {
    const singular = {
      schemaVersion: 1,
      phase: "CHALLENGE_RECEIVED",
      challengeId: "cid",
      method: "EMAIL_OTP",   // singular — rejected
      methods: [],            // empty — also rejected
      purpose: "REGISTRATION_EMAIL_VERIFY",
      expiresAt: "2030-01-01T00:05:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    getItemAsyncMock.mockResolvedValue(JSON.stringify(singular));
    const result = await loadRegistrationSession();
    expect(result).toEqual({ kind: "CORRUPT" });
  });

  it("returns { kind: 'CORRUPT' } for methods containing OTP instead of EMAIL_OTP", async () => {
    const wrongMethod = {
      schemaVersion: 1,
      phase: "CHALLENGE_RECEIVED",
      challengeId: "cid",
      methods: ["OTP"],
      purpose: "REGISTRATION_EMAIL_VERIFY",
      expiresAt: "2030-01-01T00:05:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    getItemAsyncMock.mockResolvedValue(JSON.stringify(wrongMethod));
    const result = await loadRegistrationSession();
    expect(result).toEqual({ kind: "CORRUPT" });
  });

  it("returns { kind: 'CORRUPT' } when BEGIN_UNKNOWN contains unexpected email field", async () => {
    const leaked = {
      schemaVersion: 1,
      phase: "BEGIN_UNKNOWN",
      createdAt: "2026-01-01T00:00:00.000Z",
      email: "leaked@example.com", // must be rejected
    };
    getItemAsyncMock.mockResolvedValue(JSON.stringify(leaked));
    const result = await loadRegistrationSession();
    expect(result).toEqual({ kind: "CORRUPT" });
  });

  it("returns { kind: 'CORRUPT' } when CHALLENGE_RECEIVED contains password field", async () => {
    const leaked = {
      ...validChallengeReceived,
      password: "hunter2", // must be rejected
    };
    getItemAsyncMock.mockResolvedValue(JSON.stringify(leaked));
    const result = await loadRegistrationSession();
    expect(result).toEqual({ kind: "CORRUPT" });
  });
});

// ─── S5: SecureStore read errors propagate ────────────────────────────────────
describe("S5 – loadRegistrationSession: propagates SecureStore read errors", () => {
  it("propagates hardware/OS errors and does NOT return CORRUPT", async () => {
    const hardwareError = new Error("SecureStore: hardware not available");
    getItemAsyncMock.mockRejectedValue(hardwareError);
    await expect(loadRegistrationSession()).rejects.toThrow(
      "SecureStore: hardware not available",
    );
  });
});

// ─── S6: saveRegistrationSession writes only canonical keys ──────────────────
describe("S6 – saveRegistrationSession: canonical serialization", () => {
  it("writes BEGIN_UNKNOWN with only schemaVersion, phase, createdAt", async () => {
    await saveRegistrationSession(validBeginUnknown);
    expect(setItemAsyncMock).toHaveBeenCalledTimes(1);
    const written = JSON.parse(setItemAsyncMock.mock.calls[0][1] as string);
    expect(Object.keys(written).sort()).toEqual(
      ["schemaVersion", "phase", "createdAt"].sort(),
    );
    expect(written.schemaVersion).toBe(1);
    expect(written.phase).toBe("BEGIN_UNKNOWN");
  });

  it("writes CHALLENGE_RECEIVED with canonical keys including optional resendAfter", async () => {
    await saveRegistrationSession(validChallengeReceived);
    const written = JSON.parse(setItemAsyncMock.mock.calls[0][1] as string);
    const expectedKeys = [
      "schemaVersion",
      "phase",
      "challengeId",
      "methods",
      "purpose",
      "expiresAt",
      "resendAfter",
      "createdAt",
    ];
    expect(Object.keys(written).sort()).toEqual(expectedKeys.sort());
    expect(written.methods).toEqual(["EMAIL_OTP"]);
    expect(written.purpose).toBe("REGISTRATION_EMAIL_VERIFY");
  });

  it("does NOT write email, phone, password, OTP, proof, or token fields", async () => {
    const maliciousInput = {
      ...validChallengeReceived,
      email: "SENTINEL_CONTACT_EMAIL",
      phone: "SENTINEL_CONTACT_PHONE",
      password: "SENTINEL_PASSWORD",
      otp: "SENTINEL_OTP",
      proof: "SENTINEL_PROOF",
      token: "SENTINEL_TOKEN",
    } as any;

    await saveRegistrationSession(maliciousInput);

    expect(setItemAsyncMock).toHaveBeenCalledTimes(1);
    const writtenString = setItemAsyncMock.mock.calls[0][1] as string;
    const written = JSON.parse(writtenString) as Record<string, unknown>;

    const expectedKeys = [
      "schemaVersion",
      "phase",
      "challengeId",
      "methods",
      "purpose",
      "expiresAt",
      "resendAfter",
      "createdAt",
    ];
    expect(Object.keys(written).sort()).toEqual(expectedKeys.sort());
    expect(written).toEqual(validChallengeReceived);

    expect(writtenString).not.toContain("SENTINEL_CONTACT_EMAIL");
    expect(writtenString).not.toContain("SENTINEL_CONTACT_PHONE");
    expect(writtenString).not.toContain("SENTINEL_PASSWORD");
    expect(writtenString).not.toContain("SENTINEL_OTP");
    expect(writtenString).not.toContain("SENTINEL_PROOF");
    expect(writtenString).not.toContain("SENTINEL_TOKEN");
  });

  it("omits resendAfter when not present", async () => {
    const noResend: RegistrationSessionV1 = {
      schemaVersion: 1,
      phase: "CHALLENGE_RECEIVED",
      challengeId: "cid-no-resend",
      methods: ["EMAIL_OTP"],
      purpose: "REGISTRATION_EMAIL_VERIFY",
      expiresAt: "2030-01-01T00:05:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    await saveRegistrationSession(noResend);
    const written = JSON.parse(setItemAsyncMock.mock.calls[0][1] as string);
    expect("resendAfter" in written).toBe(false);
  });
});

// ─── S7: deleteRegistrationSession removes the key ───────────────────────────
describe("S7 – deleteRegistrationSession: removes the key", () => {
  it("calls deleteItemAsync with the correct key and options", async () => {
    await deleteRegistrationSession();
    expect(deleteItemAsyncMock).toHaveBeenCalledWith(
      REGISTRATION_SESSION_KEY,
      SECURE_STORE_OPTIONS,
    );
  });

  it("propagates delete errors to the caller", async () => {
    deleteItemAsyncMock.mockRejectedValue(new Error("delete failed"));
    await expect(deleteRegistrationSession()).rejects.toThrow("delete failed");
  });
});

// ─── S8: mutation queue serializes concurrent operations ─────────────────────
describe("S8 – mutation queue: serializes concurrent writes", () => {
  it("resolves operations in FIFO order", async () => {
    const order: string[] = [];

    setItemAsyncMock.mockImplementation(async () => {
      await Promise.resolve();
      order.push("write");
    });
    getItemAsyncMock.mockImplementation(async () => {
      await Promise.resolve();
      order.push("read");
      return null;
    });

    const p1 = saveRegistrationSession(validBeginUnknown);
    const p2 = loadRegistrationSession();
    await Promise.all([p1, p2]);
    expect(order).toEqual(["write", "read"]);
  });
});

// ─── S9: round-trip load/save/load ───────────────────────────────────────────
describe("S9 – round-trip: save and load returns identical session", () => {
  it("persists and reloads BEGIN_UNKNOWN faithfully", async () => {
    let stored: string | null = null;
    setItemAsyncMock.mockImplementation(async (_key: string, value: string) => {
      stored = value;
    });
    getItemAsyncMock.mockImplementation(async () => stored);

    await saveRegistrationSession(validBeginUnknown);
    const result = await loadRegistrationSession();
    expect(result.kind).toBe("VALID");
    if (result.kind === "VALID") {
      expect(result.session).toEqual(validBeginUnknown);
    }
  });

  it("persists and reloads CHALLENGE_RECEIVED faithfully", async () => {
    let stored: string | null = null;
    setItemAsyncMock.mockImplementation(async (_key: string, value: string) => {
      stored = value;
    });
    getItemAsyncMock.mockImplementation(async () => stored);

    await saveRegistrationSession(validChallengeReceived);
    const result = await loadRegistrationSession();
    expect(result.kind).toBe("VALID");
    if (result.kind === "VALID") {
      expect(result.session).toEqual(validChallengeReceived);
    }
  });
});
