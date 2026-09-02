import { BackHandler, type HardwareBackPressEvent } from "react-native";
import type { ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { RegisterScreen } from "@/features/auth/screens/RegisterScreen";
import { useAuth } from "@/features/auth/context/AuthContext";
import type { AuthChallengeResponse } from "@/features/auth/types/auth";
import { ApiError } from "@/services/api/ApiError";

const mockReplace = jest.fn();

jest.mock("expo-router", () => ({
  Link: ({ children }: { children: ReactNode }) => children,
  useRouter: () => ({ replace: mockReplace }),
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: jest.fn(),
}));

const useAuthMock = jest.mocked(useAuth);
const registerMock = jest.fn();
const cancelRegistrationMock = jest.fn();
const resendRegistrationChallengeMock = jest.fn();
const verifyRegistrationChallengeMock = jest.fn();

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

function createDeferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
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
    await Promise.resolve();
    await Promise.resolve();
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

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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
});

afterEach(() => {
  jest.restoreAllMocks();
});

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
