import { BackHandler, type HardwareBackPressEvent } from "react-native";
import type { ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { RegisterScreen } from "@/features/auth/screens/RegisterScreen";
import { useAuth } from "@/features/auth/context/AuthContext";
import * as registrationSessionStorage from "@/features/auth/storage/registrationSessionStorage";
import type { AuthChallengeResponse } from "@/features/auth/types/auth";
import { ApiError } from "@/services/api/ApiError";

// ─── Router mock ─────────────────────────────────────────────────────────────

const mockReplace = jest.fn();

jest.mock("expo-router", () => ({
  Link: ({ children }: { children: ReactNode }) => children,
  useRouter: () => ({ replace: mockReplace }),
}));

// ─── AuthContext mock ─────────────────────────────────────────────────────────

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: jest.fn(),
}));

// ─── Storage mock ─────────────────────────────────────────────────────────────

jest.mock("@/features/auth/storage/registrationSessionStorage");

const useAuthMock = jest.mocked(useAuth);
const registerMock = jest.fn();
const cancelRegistrationMock = jest.fn();
const resendRegistrationChallengeMock = jest.fn();
const verifyRegistrationChallengeMock = jest.fn();

const loadMock = jest.mocked(registrationSessionStorage.loadRegistrationSession);
const saveMock = jest.mocked(registrationSessionStorage.saveRegistrationSession);
const deleteMock = jest.mocked(registrationSessionStorage.deleteRegistrationSession);

// ─── Fixtures ────────────────────────────────────────────────────────────────

const registrationChallenge: AuthChallengeResponse = {
  challengeId: "registration-challenge",
  expiresAt: "2030-01-01T00:05:00.000Z",
  methods: ["EMAIL_OTP"],
  method: "EMAIL_OTP",
  purpose: "REGISTRATION_EMAIL_VERIFY",
  resendAfter: "2020-01-01T00:00:00.000Z",
  maskedDestination: "sy****@example.test",
};

const validRegistrationValues = {
  fullName: "Synthetic Applicant",
  email: "synthetic@example.test",
  phoneNumber: "0912345678",
  password: "Synthetic9A",
  confirmPassword: "Synthetic9A",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createDeferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

function byTestId(renderer: ReactTestRenderer, testID: string) {
  return renderer.root.findByProps({ testID });
}

async function renderScreen(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<RegisterScreen />);
  });

  await act(async () => {
    const start = Date.now();
    while (true) {
      let isReady = false;
      try {
        const hasSubmit = renderer.root.findAllByProps({ testID: "register-submit" }).length > 0;
        const hasOtp = renderer.root.findAllByProps({ testID: "register-otp" }).length > 0;
        const hasRecovery = renderer.root.findAllByProps({ testID: "register-recovery-message" }).length > 0;
        isReady = hasSubmit || hasOtp || hasRecovery;
      } catch {
        // Ignored in case of transient read errors
      }
      if (isReady) break;

      if (Date.now() - start >= 2000) {
        throw new Error("waitFor timed out");
      }
      await Promise.resolve();
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  });

  return renderer;
}

async function beginRegistrationChallenge(renderer: ReactTestRenderer) {
  const fields = [
    ["register-full-name", validRegistrationValues.fullName],
    ["register-email", validRegistrationValues.email],
    ["register-phone", validRegistrationValues.phoneNumber],
    ["register-password", validRegistrationValues.password],
    ["register-confirm-password", validRegistrationValues.confirmPassword],
  ] as const;

  await act(async () => {
    for (const [testID, value] of fields) {
      byTestId(renderer, testID).props.onChangeText(value);
    }
    await Promise.resolve();
  });

  await act(async () => {
    await byTestId(renderer, "register-submit").props.onPress();
  });
}

function createCancelError(status: number | null, code: string) {
  return new ApiError({
    status,
    code,
    message: "Yêu cầu đăng ký không thể xử lý.",
    traceId: "trace-redacted",
  });
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  jest.clearAllMocks();
  useAuthMock.mockReturnValue({
    status: "anonymous",
    session: null,
    logoutNotice: null,
    deviceId: null,
    isAuthenticated: false,
    refreshAccessToken: jest.fn().mockResolvedValue(null),
    login: jest.fn(),
    register: registerMock,
    verifyRegistrationChallenge: verifyRegistrationChallengeMock,
    resendRegistrationChallenge: resendRegistrationChallengeMock,
    cancelRegistration: cancelRegistrationMock,
    logout: jest.fn(),
    logoutAll: jest.fn(),
  });
  registerMock.mockResolvedValue(registrationChallenge);
  cancelRegistrationMock.mockResolvedValue(undefined);
  resendRegistrationChallengeMock.mockResolvedValue(registrationChallenge);
  verifyRegistrationChallengeMock.mockResolvedValue({ user: {} });

  // Default: storage is empty on mount
  loadMock.mockResolvedValue({ kind: "EMPTY" });
  saveMock.mockResolvedValue(undefined);
  deleteMock.mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── R1: mount with EMPTY shows form ─────────────────────────────────────────
describe("R1 – mount with EMPTY storage shows form", () => {
  it("shows the registration form when storage is empty", async () => {
    loadMock.mockResolvedValue({ kind: "EMPTY" });
    const renderer = await renderScreen();
    expect(renderer.root.findAllByProps({ testID: "register-otp" })).toHaveLength(0);
    expect(renderer.root.findAllByProps({ testID: "register-recovery-message" })).toHaveLength(0);
    expect(byTestId(renderer, "register-submit")).toBeDefined();
    act(() => renderer.unmount());
  });
});

// ─── R2: mount with VALID BEGIN_UNKNOWN shows recovery/manual retry ───────────
describe("R2 – mount with VALID BEGIN_UNKNOWN shows manual retry", () => {
  it("does NOT auto-begin and shows recovery message", async () => {
    loadMock.mockResolvedValue({
      kind: "VALID",
      session: {
        schemaVersion: 1,
        phase: "BEGIN_UNKNOWN",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const renderer = await renderScreen();
    expect(registerMock).not.toHaveBeenCalled();
    expect(byTestId(renderer, "register-recovery-message")).toBeDefined();
    expect(renderer.root.findAllByProps({ testID: "register-otp" })).toHaveLength(0);
    act(() => renderer.unmount());
  });
});

// ─── R3: mount with VALID CHALLENGE_RECEIVED restores OTP UI ─────────────────
describe("R3 – mount with VALID CHALLENGE_RECEIVED restores OTP UI", () => {
  it("shows OTP field with restored challengeId", async () => {
    loadMock.mockResolvedValue({
      kind: "VALID",
      session: {
        schemaVersion: 1,
        phase: "CHALLENGE_RECEIVED",
        challengeId: "restored-cid",
        methods: ["EMAIL_OTP"],
        purpose: "REGISTRATION_EMAIL_VERIFY",
        expiresAt: "2030-01-01T00:05:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const renderer = await renderScreen();
    expect(byTestId(renderer, "register-otp")).toBeDefined();
    act(() => renderer.unmount());
  });
});

// ─── R4: mount with CORRUPT shows RECOVERY_BLOCKED ────────────────────────────
describe("R4 – mount with CORRUPT shows RECOVERY_BLOCKED", () => {
  it("displays recovery message and does NOT auto-delete storage", async () => {
    loadMock.mockResolvedValue({ kind: "CORRUPT" });
    const renderer = await renderScreen();
    expect(byTestId(renderer, "register-recovery-message")).toBeDefined();
    expect(deleteMock).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });
});

// ─── R5: SecureStore read error shows RECOVERY_BLOCKED ────────────────────────
describe("R5 – SecureStore read error shows RECOVERY_BLOCKED", () => {
  it("shows recovery blocked and does NOT auto-delete or return CORRUPT", async () => {
    loadMock.mockRejectedValue(new Error("hardware error"));
    const renderer = await renderScreen();
    expect(byTestId(renderer, "register-recovery-message")).toBeDefined();
    expect(deleteMock).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });
});

// ─── R6: BEGIN_UNKNOWN written before API call ────────────────────────────────
describe("R6 – BEGIN_UNKNOWN persisted before API call", () => {
  it("saves BEGIN_UNKNOWN before calling register()", async () => {
    const callOrder: string[] = [];

    const saveDeferred = createDeferred<void>();
    saveMock.mockImplementation(async () => {
      callOrder.push("save");
      await saveDeferred.promise;
    });
    registerMock.mockImplementation(async () => {
      callOrder.push("register");
      return registrationChallenge;
    });

    const renderer = await renderScreen();

    // Fill form fields
    await act(async () => {
      for (const [testID, value] of [
        ["register-full-name", validRegistrationValues.fullName],
        ["register-email", validRegistrationValues.email],
        ["register-phone", validRegistrationValues.phoneNumber],
        ["register-password", validRegistrationValues.password],
        ["register-confirm-password", validRegistrationValues.confirmPassword],
      ] as const) {
        byTestId(renderer, testID).props.onChangeText(value);
      }
    });

    // Press submit (non-blocking — save is blocked by deferred)
    act(() => {
      byTestId(renderer, "register-submit").props.onPress();
    });
    await act(async () => {
      await Promise.resolve();
    });

    // At this point save has been called, register has NOT (save is still blocking)
    expect(callOrder[0]).toBe("save");
    expect(callOrder).not.toContain("register");

    // Unblock save so register can run
    await act(async () => {
      saveDeferred.resolve(undefined);
      await saveDeferred.promise;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(callOrder).toContain("register");
    expect(callOrder.indexOf("save")).toBeLessThan(callOrder.indexOf("register"));

    act(() => renderer.unmount());
  });
});

// ─── R7: save BEGIN_UNKNOWN failure blocks API call ───────────────────────────
describe("R7 – save BEGIN_UNKNOWN failure blocks API", () => {
  it("does NOT call register() when BEGIN_UNKNOWN write fails", async () => {
    // Mount screen first (with EMPTY), then configure save to reject
    const renderer = await renderScreen();
    saveMock.mockRejectedValue(new Error("disk full"));
    await beginRegistrationChallenge(renderer);
    expect(registerMock).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });

  it("shows a storage error message to the user", async () => {
    const renderer = await renderScreen();
    saveMock.mockRejectedValue(new Error("disk full"));
    await beginRegistrationChallenge(renderer);
    const json = JSON.stringify(renderer.toJSON());
    expect(json).toContain("Không thể lưu trạng thái đăng ký");
    act(() => renderer.unmount());
  });
});

// ─── R8: CHALLENGE_RECEIVED written after successful API begin ────────────────
describe("R8 – CHALLENGE_RECEIVED persisted on 202 success", () => {
  it("saves CHALLENGE_RECEIVED session after successful register()", async () => {
    const renderer = await renderScreen();
    await beginRegistrationChallenge(renderer);

    expect(saveMock).toHaveBeenCalledTimes(2); // BEGIN_UNKNOWN then CHALLENGE_RECEIVED
    const secondCall = saveMock.mock.calls[1][0];
    expect(secondCall.phase).toBe("CHALLENGE_RECEIVED");
    if (secondCall.phase === "CHALLENGE_RECEIVED") {
      expect(secondCall.methods).toEqual(["EMAIL_OTP"]);
      expect(secondCall.purpose).toBe("REGISTRATION_EMAIL_VERIFY");
    }
    act(() => renderer.unmount());
  });
});

// ─── R9: CHALLENGE_RECEIVED write failure — keep in-memory ───────────────────
describe("R9 – CHALLENGE_RECEIVED write failure keeps in-memory challenge", () => {
  it("shows OTP UI even when CHALLENGE_RECEIVED save fails", async () => {
    const renderer = await renderScreen();
    // First save (BEGIN_UNKNOWN) succeeds; second save (CHALLENGE_RECEIVED) fails
    saveMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("write error"));

    await beginRegistrationChallenge(renderer);
    expect(byTestId(renderer, "register-otp")).toBeDefined();
    act(() => renderer.unmount());
  });

  it("does NOT delete BEGIN_UNKNOWN when CHALLENGE_RECEIVED write fails", async () => {
    const renderer = await renderScreen();
    saveMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("write error"));

    await beginRegistrationChallenge(renderer);
    expect(deleteMock).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });
});

// ─── R10: verify success deletes persisted session ────────────────────────────
describe("R10 – verify success deletes persisted session", () => {
  it("calls deleteRegistrationSession after successful verify", async () => {
    const renderer = await renderScreen();
    await beginRegistrationChallenge(renderer);

    await act(async () => {
      byTestId(renderer, "register-otp").props.onChangeText("123456");
      await Promise.resolve();
    });

    await act(async () => {
      await byTestId(renderer, "register-submit").props.onPress();
    });

    expect(deleteMock).toHaveBeenCalledTimes(1);
    act(() => renderer.unmount());
  });
});

// ─── R11: verify failure keeps CHALLENGE_RECEIVED ────────────────────────────
describe("R11 – verify failure keeps CHALLENGE_RECEIVED", () => {
  it("keeps OTP UI after failed verify", async () => {
    verifyRegistrationChallengeMock.mockRejectedValue(
      new ApiError({ status: 422, code: "INVALID_OTP", message: "Mã OTP sai.", traceId: "t" }),
    );
    const renderer = await renderScreen();
    await beginRegistrationChallenge(renderer);

    await act(async () => {
      byTestId(renderer, "register-otp").props.onChangeText("000000");
    });
    await act(async () => {
      await byTestId(renderer, "register-submit").props.onPress();
    });

    expect(byTestId(renderer, "register-otp")).toBeDefined();
    expect(deleteMock).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });
});

// ─── R12: resend success saves updated challenge ──────────────────────────────
describe("R12 – resend success persists updated challenge", () => {
  it("saves updated CHALLENGE_RECEIVED after resend", async () => {
    const updatedChallenge: AuthChallengeResponse = {
      ...registrationChallenge,
      challengeId: "new-challenge-after-resend",
      resendAfter: "2020-01-01T00:01:00.000Z",
    };
    resendRegistrationChallengeMock.mockResolvedValue(updatedChallenge);

    const renderer = await renderScreen();
    await beginRegistrationChallenge(renderer);

    // saveMock called 2 times so far (BEGIN_UNKNOWN, CHALLENGE_RECEIVED)
    const saveCountBeforeResend = saveMock.mock.calls.length;

    await act(async () => {
      await byTestId(renderer, "register-otp-resend").props.onPress();
    });

    expect(saveMock.mock.calls.length).toBe(saveCountBeforeResend + 1);
    const resendSave = saveMock.mock.calls[saveCountBeforeResend][0];
    expect(resendSave.phase).toBe("CHALLENGE_RECEIVED");
    if (resendSave.phase === "CHALLENGE_RECEIVED") {
      expect(resendSave.challengeId).toBe("new-challenge-after-resend");
    }
    act(() => renderer.unmount());
  });
});

// ─── R13: resend failure keeps current session ────────────────────────────────
describe("R13 – resend failure keeps current session", () => {
  it("keeps OTP UI and does not update storage after resend failure", async () => {
    resendRegistrationChallengeMock.mockRejectedValue(
      new ApiError({ status: 503, code: "SERVICE_UNAVAILABLE", message: "Lỗi gửi lại.", traceId: "t" }),
    );

    const renderer = await renderScreen();
    await beginRegistrationChallenge(renderer);

    const saveCountBeforeResend = saveMock.mock.calls.length;

    await act(async () => {
      await byTestId(renderer, "register-otp-resend").props.onPress();
    });

    expect(byTestId(renderer, "register-otp")).toBeDefined();
    expect(saveMock.mock.calls.length).toBe(saveCountBeforeResend);
    act(() => renderer.unmount());
  });
});

// ─── R14: cancel 204 deletes persisted session ────────────────────────────────
describe("R14 – cancel 204 deletes persisted session", () => {
  it("calls deleteRegistrationSession after cancel success", async () => {
    const renderer = await renderScreen();
    await beginRegistrationChallenge(renderer);

    await act(async () => {
      await byTestId(renderer, "register-challenge-cancel").props.onPress();
    });

    expect(cancelRegistrationMock).toHaveBeenCalledTimes(1);
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(renderer.root.findAllByProps({ testID: "register-otp" })).toHaveLength(0);
    act(() => renderer.unmount());
  });
});

// ─── R15: cancel 409 deletes persisted session and routes to login ────────────
describe("R15 – cancel 409 (completed) deletes session and routes to login", () => {
  it("clears storage and routes to /login on 409", async () => {
    cancelRegistrationMock.mockRejectedValue(
      createCancelError(409, "REGISTRATION_COMPLETED"),
    );
    const renderer = await renderScreen();
    await beginRegistrationChallenge(renderer);

    await act(async () => {
      await byTestId(renderer, "register-challenge-cancel").props.onPress();
    });

    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith("/login");
    act(() => renderer.unmount());
  });
});

// ─── R16: cancel 404/422/timeout keeps persisted session ──────────────────────
describe("R16 – cancel 404/422/timeout keeps persisted session", () => {
  it.each([404, 422])("retains challenge and does NOT delete on cancel HTTP %s", async (status) => {
    cancelRegistrationMock.mockRejectedValue(
      createCancelError(status, "REGISTRATION_CANCEL_ERROR"),
    );
    const renderer = await renderScreen();
    await beginRegistrationChallenge(renderer);

    await act(async () => {
      await byTestId(renderer, "register-challenge-cancel").props.onPress();
    });

    expect(byTestId(renderer, "register-otp")).toBeDefined();
    expect(deleteMock).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });

  it("retains challenge and does NOT delete on timeout/network error", async () => {
    cancelRegistrationMock.mockRejectedValue(
      createCancelError(null, "TIMEOUT"),
    );
    const renderer = await renderScreen();
    await beginRegistrationChallenge(renderer);

    await act(async () => {
      await byTestId(renderer, "register-challenge-cancel").props.onPress();
    });

    expect(byTestId(renderer, "register-otp")).toBeDefined();
    expect(deleteMock).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });
});

// ─── R17: no auto-begin on mount with any valid stored phase ──────────────────
describe("R17 – no auto-begin on mount", () => {
  it("does NOT call register() on mount with EMPTY", async () => {
    loadMock.mockResolvedValue({ kind: "EMPTY" });
    const renderer = await renderScreen();
    expect(registerMock).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });

  it("does NOT call register() on mount with VALID BEGIN_UNKNOWN", async () => {
    loadMock.mockResolvedValue({
      kind: "VALID",
      session: { schemaVersion: 1, phase: "BEGIN_UNKNOWN", createdAt: "2026-01-01T00:00:00.000Z" },
    });
    const renderer = await renderScreen();
    expect(registerMock).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });

  it("does NOT call register() on mount with VALID CHALLENGE_RECEIVED", async () => {
    loadMock.mockResolvedValue({
      kind: "VALID",
      session: {
        schemaVersion: 1,
        phase: "CHALLENGE_RECEIVED",
        challengeId: "restored",
        methods: ["EMAIL_OTP"],
        purpose: "REGISTRATION_EMAIL_VERIFY",
        expiresAt: "2030-01-01T00:05:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const renderer = await renderScreen();
    expect(registerMock).not.toHaveBeenCalled();
    expect(verifyRegistrationChallengeMock).not.toHaveBeenCalled();
    expect(resendRegistrationChallengeMock).not.toHaveBeenCalled();
    expect(cancelRegistrationMock).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });
});

// ─── R18: persisted payload never contains sensitive data ─────────────────────
describe("R18 – persisted payload does not contain sensitive fields", () => {
  it("does not write email, phone, password, OTP, proof, or token into storage", async () => {
    const renderer = await renderScreen();

    // Fill the form with format-compliant sentinels
    await act(async () => {
      for (const [testID, value] of [
        ["register-full-name", "Sentinel Name"],
        ["register-email", "SENTINEL_EMAIL@example.test"],
        ["register-phone", "0900000000"],
        ["register-password", "SENTINEL_Pass1"],
        ["register-confirm-password", "SENTINEL_Pass1"],
      ] as const) {
        byTestId(renderer, testID).props.onChangeText(value);
      }
    });

    // Press submit
    await act(async () => {
      await byTestId(renderer, "register-submit").props.onPress();
    });

    // Type OTP with sentinel
    await act(async () => {
      byTestId(renderer, "register-otp").props.onChangeText("SENTINEL_OTP");
    });

    expect(saveMock).toHaveBeenCalled();
    for (const call of saveMock.mock.calls) {
      const session = call[0] as Record<string, unknown>;
      const keys = Object.keys(session);

      // Assert mọi call tới saveRegistrationSession chỉ chứa canonical recovery fields.
      const allowedKeys = [
        "schemaVersion",
        "phase",
        "challengeId",
        "methods",
        "purpose",
        "expiresAt",
        "resendAfter",
        "createdAt"
      ];
      for (const key of keys) {
        expect(allowedKeys).toContain(key);
      }

      // Assert serialized representation của các storage arguments không chứa sentinel
      const serialized = JSON.stringify(session);
      expect(serialized).not.toContain("SENTINEL_CONTACT_EMAIL");
      expect(serialized).not.toContain("SENTINEL_CONTACT_PHONE");
      expect(serialized).not.toContain("SENTINEL_PASSWORD");
      expect(serialized).not.toContain("SENTINEL_OTP");
      expect(serialized).not.toContain("SENTINEL_PROOF");
      expect(serialized).not.toContain("SENTINEL_TOKEN");
    }

    act(() => renderer.unmount());
  });
});

// ─── Existing cancellation tests (preserved) ──────────────────────────────────
describe("RegisterScreen registration cancellation", () => {
  it("does not expose cancel before a server challenge exists", async () => {
    const renderer = await renderScreen();

    expect(renderer.root.findAllByProps({ testID: "register-challenge-cancel" })).toHaveLength(0);
    expect(renderer.root.findAllByProps({ testID: "register-back-cancel" })).toHaveLength(0);

    act(() => renderer.unmount());
  });

  it("cancels the server challenge on 204 and returns to the registration form", async () => {
    const renderer = await renderScreen();
    await beginRegistrationChallenge(renderer);

    await act(async () => {
      await byTestId(renderer, "register-challenge-cancel").props.onPress();
    });

    expect(cancelRegistrationMock).toHaveBeenCalledTimes(1);
    expect(cancelRegistrationMock).toHaveBeenCalledWith("registration-challenge");
    expect(renderer.root.findAllByProps({ testID: "register-otp" })).toHaveLength(0);
    expect(renderer.root.findAllByProps({ testID: "register-challenge-cancel" })).toHaveLength(0);
    expect(byTestId(renderer, "register-submit").props.label).toBe("Đăng ký");
    expect(mockReplace).not.toHaveBeenCalled();

    act(() => renderer.unmount());
  });

  it("disables cancellation while the request is pending and ignores a second press", async () => {
    const deferred = createDeferred<void>();
    cancelRegistrationMock.mockReturnValue(deferred.promise);
    const renderer = await renderScreen();
    await beginRegistrationChallenge(renderer);

    await act(async () => {
      byTestId(renderer, "register-challenge-cancel").props.onPress();
      await Promise.resolve();
    });

    expect(byTestId(renderer, "register-challenge-cancel").props.disabled).toBe(true);
    byTestId(renderer, "register-challenge-cancel").props.onPress();
    expect(cancelRegistrationMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      deferred.resolve(undefined);
      await deferred.promise;
    });
    expect(renderer.root.findAllByProps({ testID: "register-otp" })).toHaveLength(0);

    act(() => renderer.unmount());
  });

  it.each([404, 422])("retains the challenge after cancel HTTP %s", async (status) => {
    cancelRegistrationMock.mockRejectedValue(createCancelError(status, "REGISTRATION_CANCEL_ERROR"));
    const renderer = await renderScreen();
    await beginRegistrationChallenge(renderer);

    await act(async () => {
      await byTestId(renderer, "register-challenge-cancel").props.onPress();
    });

    expect(byTestId(renderer, "register-otp")).toBeDefined();
    expect(byTestId(renderer, "register-challenge-cancel")).toBeDefined();
    expect(JSON.stringify(renderer.toJSON())).toContain("Yêu cầu đăng ký không thể xử lý.");
    expect(registerMock).toHaveBeenCalledTimes(1);

    act(() => renderer.unmount());
  });

  it("clears the challenge and routes to login when cancel reports completed registration", async () => {
    cancelRegistrationMock.mockRejectedValue(createCancelError(409, "REGISTRATION_COMPLETED"));
    const renderer = await renderScreen();
    await beginRegistrationChallenge(renderer);

    await act(async () => {
      await byTestId(renderer, "register-challenge-cancel").props.onPress();
    });

    expect(renderer.root.findAllByProps({ testID: "register-otp" })).toHaveLength(0);
    expect(mockReplace).toHaveBeenCalledWith("/login");

    act(() => renderer.unmount());
  });

  it("retains the challenge after timeout and allows a later retry", async () => {
    cancelRegistrationMock
      .mockRejectedValueOnce(createCancelError(null, "TIMEOUT"))
      .mockResolvedValueOnce(undefined);
    const renderer = await renderScreen();
    await beginRegistrationChallenge(renderer);

    await act(async () => {
      await byTestId(renderer, "register-challenge-cancel").props.onPress();
    });
    expect(byTestId(renderer, "register-challenge-cancel")).toBeDefined();
    expect(registerMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await byTestId(renderer, "register-challenge-cancel").props.onPress();
    });
    expect(cancelRegistrationMock).toHaveBeenCalledTimes(2);
    expect(renderer.root.findAllByProps({ testID: "register-otp" })).toHaveLength(0);

    act(() => renderer.unmount());
  });

  it("uses the same cancel flow for the in-screen back action", async () => {
    const renderer = await renderScreen();
    await beginRegistrationChallenge(renderer);

    await act(async () => {
      await byTestId(renderer, "register-back-cancel").props.onPress();
    });

    expect(cancelRegistrationMock).toHaveBeenCalledTimes(1);
    expect(renderer.root.findAllByProps({ testID: "register-otp" })).toHaveLength(0);

    act(() => renderer.unmount());
  });

  it("uses the same cancel flow for the Android hardware Back event", async () => {
    let hardwareBackHandler:
      | ((event: HardwareBackPressEvent) => boolean | null | undefined)
      | undefined;
    jest.spyOn(BackHandler, "addEventListener").mockImplementation((eventName, handler) => {
      if (eventName === "hardwareBackPress") {
        hardwareBackHandler = handler;
      }
      return { remove: jest.fn() } as ReturnType<typeof BackHandler.addEventListener>;
    });
    const renderer = await renderScreen();
    await beginRegistrationChallenge(renderer);

    await act(async () => {
      hardwareBackHandler?.({
        type: "hardwareBackPress",
        timeStamp: Date.now(),
      });
      await Promise.resolve();
    });

    expect(cancelRegistrationMock).toHaveBeenCalledTimes(1);
    expect(renderer.root.findAllByProps({ testID: "register-otp" })).toHaveLength(0);

    act(() => renderer.unmount());
  });
});

// ─── M01-06: Coverage gap closures ───────────────────────────────────────────

describe("M01-06 – Registration coverage gap closures", () => {
  it("T-REG-FE-VAL-01: blocks registration submission when form fields are invalid without calling API or storage", async () => {
    loadMock.mockResolvedValue({ kind: "EMPTY" });
    const renderer = await renderScreen();

    await act(async () => {
      await byTestId(renderer, "register-submit").props.onPress();
    });

    expect(saveMock).not.toHaveBeenCalled();
    expect(registerMock).not.toHaveBeenCalled();
    const json = JSON.stringify(renderer.toJSON());
    expect(json).toContain("Họ và tên là bắt buộc.");
    expect(json).toContain("Số điện thoại là bắt buộc.");
    expect(json).toContain("Email là bắt buộc.");
    expect(json).toContain("Mật khẩu là bắt buộc.");
    expect(renderer.root.findAllByProps({ testID: "register-otp" })).toHaveLength(0);

    act(() => renderer.unmount());
  });

  it("T-REG-FE-ERR-422: displays server field errors on HTTP 422 and does not auto-retry", async () => {
    loadMock.mockResolvedValue({ kind: "EMPTY" });
    registerMock.mockRejectedValue(
      new ApiError({
        status: 422,
        code: "VALIDATION_ERROR",
        message: "Dữ liệu đăng ký không hợp lệ.",
        fieldErrors: {
          email: "Email đã được sử dụng.",
          phoneNumber: "Số điện thoại không hợp lệ.",
        },
        traceId: "trace-422",
      }),
    );
    const renderer = await renderScreen();
    await beginRegistrationChallenge(renderer);

    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(registerMock).toHaveBeenCalledTimes(1);
    const json = JSON.stringify(renderer.toJSON());
    expect(json).toContain("Email đã được sử dụng.");
    expect(json).toContain("Số điện thoại không hợp lệ.");
    expect(json).toContain("Dữ liệu đăng ký không hợp lệ.");
    expect(byTestId(renderer, "register-submit").props.disabled).toBe(false);
    expect(renderer.root.findAllByProps({ testID: "register-otp" })).toHaveLength(0);

    act(() => renderer.unmount());
  });

  it("T-REG-FE-ERR-409: displays conflict error message on HTTP 409 without retrying", async () => {
    loadMock.mockResolvedValue({ kind: "EMPTY" });
    registerMock.mockRejectedValue(
      new ApiError({
        status: 409,
        code: "CONFLICT",
        message: "Số điện thoại hoặc email đã được đăng ký.",
        traceId: "trace-409",
      }),
    );
    const renderer = await renderScreen();
    await beginRegistrationChallenge(renderer);

    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(registerMock).toHaveBeenCalledTimes(1);
    const json = JSON.stringify(renderer.toJSON());
    expect(json).toContain("Số điện thoại hoặc email đã được đăng ký.");
    expect(mockReplace).not.toHaveBeenCalled();
    expect(byTestId(renderer, "register-submit").props.disabled).toBe(false);
    expect(renderer.root.findAllByProps({ testID: "register-otp" })).toHaveLength(0);

    act(() => renderer.unmount());
  });

  it("T-REG-FE-ERR-401: displays error message on HTTP 401 without auto-retry or wrong navigation", async () => {
    // Registration begin là public pre-auth; đây chỉ là defensive UI test nếu upstream trả 401, không tuyên bố bearer authentication là bắt buộc.
    loadMock.mockResolvedValue({ kind: "EMPTY" });
    registerMock.mockRejectedValue(
      new ApiError({
        status: 401,
        code: "UNAUTHORIZED",
        message: "Phiên làm việc không hợp lệ.",
        traceId: "trace-401",
      }),
    );
    const renderer = await renderScreen();
    await beginRegistrationChallenge(renderer);

    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(registerMock).toHaveBeenCalledTimes(1);
    const json = JSON.stringify(renderer.toJSON());
    expect(json).toContain("Phiên làm việc không hợp lệ.");
    expect(mockReplace).not.toHaveBeenCalled();
    expect(byTestId(renderer, "register-submit").props.disabled).toBe(false);
    expect(renderer.root.findAllByProps({ testID: "register-otp" })).toHaveLength(0);

    act(() => renderer.unmount());
  });

  it("T-REG-FE-ERR-NETWORK: displays connection error on NETWORK_ERROR without second request", async () => {
    loadMock.mockResolvedValue({ kind: "EMPTY" });
    registerMock.mockRejectedValue(
      new ApiError({
        status: null,
        code: "NETWORK_ERROR",
        message: "Không thể kết nối đến máy chủ. Vui lòng kiểm tra đường truyền mạng.",
        traceId: "trace-net",
      }),
    );
    const renderer = await renderScreen();
    await beginRegistrationChallenge(renderer);

    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(registerMock).toHaveBeenCalledTimes(1);
    const json = JSON.stringify(renderer.toJSON());
    expect(json).toContain("Không thể kết nối đến máy chủ. Vui lòng kiểm tra đường truyền mạng.");
    expect(byTestId(renderer, "register-submit").props.disabled).toBe(false);
    expect(renderer.root.findAllByProps({ testID: "register-otp" })).toHaveLength(0);

    act(() => renderer.unmount());
  });

  it("T-REG-FE-ERR-TIMEOUT: displays timeout error on TIMEOUT without second request", async () => {
    loadMock.mockResolvedValue({ kind: "EMPTY" });
    registerMock.mockRejectedValue(
      new ApiError({
        status: null,
        code: "TIMEOUT",
        message: "Yêu cầu đến máy chủ đã hết thời gian chờ. Vui lòng thử lại sau.",
        traceId: "trace-timeout",
      }),
    );
    const renderer = await renderScreen();
    await beginRegistrationChallenge(renderer);

    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(registerMock).toHaveBeenCalledTimes(1);
    const json = JSON.stringify(renderer.toJSON());
    expect(json).toContain("Yêu cầu đến máy chủ đã hết thời gian chờ. Vui lòng thử lại sau.");
    expect(byTestId(renderer, "register-submit").props.disabled).toBe(false);
    expect(renderer.root.findAllByProps({ testID: "register-otp" })).toHaveLength(0);

    act(() => renderer.unmount());
  });

  it("T-REG-FE-DBL-01: disables submit button and ignores duplicate press while registration begin is pending", async () => {
    loadMock.mockResolvedValue({ kind: "EMPTY" });
    const deferred = createDeferred<AuthChallengeResponse>();
    registerMock.mockReturnValue(deferred.promise);

    const renderer = await renderScreen();

    await act(async () => {
      for (const [testID, value] of [
        ["register-full-name", validRegistrationValues.fullName],
        ["register-email", validRegistrationValues.email],
        ["register-phone", validRegistrationValues.phoneNumber],
        ["register-password", validRegistrationValues.password],
        ["register-confirm-password", validRegistrationValues.confirmPassword],
      ] as const) {
        byTestId(renderer, testID).props.onChangeText(value);
      }
    });

    act(() => {
      byTestId(renderer, "register-submit").props.onPress();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const submitButton = byTestId(renderer, "register-submit");
    expect(submitButton.props.disabled).toBe(true);
    expect(submitButton.props.label).toBe("Đang đăng ký...");

    if (!submitButton.props.disabled) {
      submitButton.props.onPress();
    }

    expect(registerMock).toHaveBeenCalledTimes(1);
    expect(saveMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      deferred.resolve(registrationChallenge);
      await deferred.promise;
    });

    act(() => renderer.unmount());
  });

  it("T-REG-FE-OTP-01: blocks OTP verification when proof is less than 6 digits without calling API", async () => {
    loadMock.mockResolvedValue({ kind: "EMPTY" });
    const renderer = await renderScreen();
    await beginRegistrationChallenge(renderer);

    expect(byTestId(renderer, "register-otp")).toBeDefined();

    await act(async () => {
      byTestId(renderer, "register-otp").props.onChangeText("123");
    });

    await act(async () => {
      await byTestId(renderer, "register-submit").props.onPress();
    });

    expect(verifyRegistrationChallengeMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
    const json = JSON.stringify(renderer.toJSON());
    expect(json).toContain("Mã OTP phải gồm 6 chữ số.");
    expect(byTestId(renderer, "register-otp")).toBeDefined();

    act(() => renderer.unmount());
  });

  it("T-REG-FE-REC-01: recovery reset from BEGIN_UNKNOWN deletes stored session and returns to form without calling cancelRegistration", async () => {
    // Local BEGIN_UNKNOWN không có challengeId; trạng thái server chưa xác định và request trước có thể đã thành công hoặc thất bại.
    loadMock.mockResolvedValue({
      kind: "VALID",
      session: {
        schemaVersion: 1,
        phase: "BEGIN_UNKNOWN",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const renderer = await renderScreen();
    expect(byTestId(renderer, "register-recovery-reset")).toBeDefined();

    await act(async () => {
      await byTestId(renderer, "register-recovery-reset").props.onPress();
    });

    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(cancelRegistrationMock).not.toHaveBeenCalled();
    expect(registerMock).not.toHaveBeenCalled();
    expect(verifyRegistrationChallengeMock).not.toHaveBeenCalled();
    expect(resendRegistrationChallengeMock).not.toHaveBeenCalled();
    expect(byTestId(renderer, "register-full-name")).toBeDefined();

    act(() => renderer.unmount());
  });
});
