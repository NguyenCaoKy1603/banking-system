import { ExpoRoot } from "expo-router/build/ExpoRoot";
import { router, Stack } from "expo-router";
import { inMemoryContext } from "expo-router/build/testing-library/context-stubs";
import { AppState, Text, View } from "react-native";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import FinancialAdviceRoute from "@/app/financial-advice";
import * as authApi from "@/features/auth/services/authApi";
import { AuthProvider, useAuth } from "@/features/auth/context/AuthContext";
import * as authSessionStorage from "@/features/auth/storage/authSessionStorage";
import * as deviceBindingStorage from "@/features/auth/storage/deviceBindingStorage";

jest.mock("@/features/auth/services/authApi", () => ({
  login: jest.fn(),
  refreshSession: jest.fn(),
  register: jest.fn(),
  resendRegistrationChallenge: jest.fn(),
  cancelRegistration: jest.fn(),
  revokeAllSessions: jest.fn(),
  revokeSession: jest.fn(),
  verifyRegistrationChallenge: jest.fn(),
}));

jest.mock("@/features/auth/storage/authSessionStorage", () => ({
  clearAuthSession: jest.fn(),
  loadAuthSession: jest.fn(),
  saveAuthSession: jest.fn(),
}));

jest.mock("@/features/auth/storage/deviceBindingStorage", () => ({
  loadDeviceBindingId: jest.fn(),
}));

jest.mock("expo-crypto", () => ({
  ...jest.requireActual("expo-crypto"),
  randomUUID: jest.fn(() => "synthetic-session-epoch-2"),
}));

const loginMock = jest.mocked(authApi.login);
const refreshSessionMock = jest.mocked(authApi.refreshSession);
const revokeSessionMock = jest.mocked(authApi.revokeSession);
const loadAuthSessionMock = jest.mocked(authSessionStorage.loadAuthSession);
const clearAuthSessionMock = jest.mocked(authSessionStorage.clearAuthSession);
const saveAuthSessionMock = jest.mocked(authSessionStorage.saveAuthSession);
const loadDeviceBindingIdMock = jest.mocked(deviceBindingStorage.loadDeviceBindingId);

const initialUser = {
  id: "synthetic-customer-1",
  fullName: "Người dùng kiểm thử",
  email: "synthetic@example.test",
  phoneNumber: "0900000000",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const storedSession = {
  accessToken: "synthetic-stored-access-token",
  refreshToken: "synthetic-stored-refresh-token",
  accessTokenExpiresAt: Date.now() + 900_000,
  sessionEpoch: "synthetic-session-epoch-1",
  user: initialUser,
};

const refreshedSessionResponse = {
  accessToken: "synthetic-refreshed-access-token",
  refreshToken: "synthetic-refreshed-refresh-token",
  expiresInSeconds: 900,
  user: initialUser,
};

const successfulAdviceResponse = {
  schemaVersion: "1",
  kind: "SAVINGS_PLAN",
  currency: "VND",
  source: "USER_ENTERED",
  calculationVersion: "fa-calc-v1",
  catalogVersion: "fa-catalog-v2",
  budgetStatus: "SURPLUS",
  goalStatus: "GAP",
  metrics: {
    declaredOutgoingsMinor: "8500000",
    unallocatedBeforeBufferMinor: "1500000",
    capacityAfterBufferMinor: "1500000",
    bufferShortfallMinor: "0",
    remainingGoalMinor: "10000000",
    requiredMonthlySavingsMinor: "2000000",
    monthlyGapMinor: "500000",
    achievableGoalAtDeadlineMinor: "9500000",
    suggestedMonths: 7,
    horizonExceeded: false,
  },
  options: [
    {
      id: "EXTEND_DEADLINE",
      title: "Kéo dài thời gian",
      description: "Theo số liệu đã nhập, cần khoảng 7 tháng để dành phần còn thiếu.",
      changes: { months: 7 },
    },
    {
      id: "REDUCE_FLEXIBLE_SPENDING",
      title: "Giảm chi tiêu linh hoạt",
      description: "Cân nhắc giảm chi linh hoạt nếu phù hợp.",
      changes: { reductionMinor: "500000", newFlexibleExpensesMinor: "1500000" },
    },
  ],
  preferredOptionId: "EXTEND_DEADLINE",
  explanation: {
    mode: "AI_ASSISTED",
    reasonIds: ["MONTHLY_GAP", "PRESERVE_CURRENT_SPENDING"],
    paragraphs: [
      "Với dữ liệu tổng hợp, phương án kéo dài thời gian giữ nguyên mức chi tiêu hiện tại.",
    ],
    fallbackReason: null,
  },
  assumptions: ["Dữ liệu tổng hợp dùng riêng cho kiểm thử giao diện."],
  warnings: [],
};

const apiUnauthorizedPayload = {
  code: "UNAUTHORIZED",
  message: "Phiên đăng nhập không còn hợp lệ.",
  fieldErrors: null,
  traceId: "synthetic-trace",
};

let fetchMock: jest.MockedFunction<typeof fetch>;
let originalFetch: typeof fetch;
let renderer: ReactTestRenderer | null = null;

beforeAll(() => {
  Object.defineProperty(AppState, "currentState", {
    configurable: true,
    value: "active",
  });
});

function AuthStateProbe() {
  const { isAuthenticated, status } = useAuth();
  return <Text testID="fa-auth-state">{`${status}:${isAuthenticated}`}</Text>;
}

function LoginRoute() {
  return <Text testID="login-route-screen">Login route is active</Text>;
}

function SessionSwitcher() {
  const { login } = useAuth();
  return (
    <Text
      onPress={() => {
        void login({ email: "new-session@example.test", password: "synthetic-only" });
      }}
      testID="fa-switch-session"
    >
      Switch synthetic session
    </Text>
  );
}

function ProtectedRoutes() {
  const { isAuthenticated } = useAuth();
  return (
    <View style={{ flex: 1 }}>
      <Stack>
        <Stack.Protected guard={!isAuthenticated}>
          <Stack.Screen name="login" />
        </Stack.Protected>
        <Stack.Protected guard={isAuthenticated}>
          <Stack.Screen name="financial-advice" />
        </Stack.Protected>
      </Stack>
    </View>
  );
}

function RootRouteLayout() {
  return (
    <AuthProvider>
      <AuthStateProbe />
      <SessionSwitcher />
      <ProtectedRoutes />
    </AuthProvider>
  );
}

function findByTestId(
  root: ReactTestRenderer,
  testID: string,
  handlerName?: string,
): ReactTestInstance {
  const matches = root.root.findAllByProps({ testID });
  const match = handlerName
    ? matches.find((node) => typeof node.props[handlerName] === "function")
    : matches[0];
  if (!match) throw new Error(`Expected testID and optional handler: ${testID}`);
  return match;
}

function collectText(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === "string" ? child : collectText(child)))
    .join("");
}

function makeResponse(status: number, payload: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => payload,
  } as Response;
}

async function flushAsyncWork(ticks = 6) {
  for (let tick = 0; tick < ticks; tick += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
  }
}

async function renderFinancialAdviceRoute() {
  process.env.EXPO_ROUTER_IMPORT_MODE = "sync";
  const context = inMemoryContext({
    _layout: RootRouteLayout,
    "financial-advice": FinancialAdviceRoute,
    login: LoginRoute,
  });
  await act(async () => {
    renderer = create(<ExpoRoot context={context} location="/financial-advice" />);
    await flushAsyncWork();
  });
  await act(async () => {
    await router.replace("/financial-advice");
    await flushAsyncWork(2);
  });
  return renderer!;
}

async function fillAndSubmitSavingsForm(root: ReactTestRenderer) {
  await act(async () => {
    findByTestId(root, "fa-income", "onChangeText").props.onChangeText("10.000.000");
    findByTestId(root, "fa-essential", "onChangeText").props.onChangeText("6.000.000");
    findByTestId(root, "fa-flexible", "onChangeText").props.onChangeText("2.000.000");
    findByTestId(root, "fa-debt-payment", "onChangeText").props.onChangeText("500.000");
    findByTestId(root, "fa-buffer", "onChangeText").props.onChangeText("0");
    findByTestId(root, "fa-goal-target", "onChangeText").props.onChangeText("12.000.000");
    findByTestId(root, "fa-goal-saved", "onChangeText").props.onChangeText("2.000.000");
    findByTestId(root, "fa-goal-months", "onChangeText").props.onChangeText("5");
    findByTestId(root, "fa-confirm-input", "onPress").props.onPress();
  });
  await act(async () => {
    findByTestId(root, "fa-submit", "onPress").props.onPress();
    await flushAsyncWork(2);
  });
}

function installFetch(implementation: typeof fetch) {
  fetchMock = jest.fn(implementation) as jest.MockedFunction<typeof fetch>;
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: fetchMock,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  originalFetch = globalThis.fetch;
  loadAuthSessionMock.mockResolvedValue(storedSession);
  loadDeviceBindingIdMock.mockResolvedValue("synthetic-device-binding");
  refreshSessionMock.mockResolvedValue(refreshedSessionResponse);
  loginMock.mockResolvedValue({
    accessToken: "synthetic-new-access-token",
    refreshToken: "synthetic-new-refresh-token",
    expiresInSeconds: 900,
    user: { ...initialUser, id: "synthetic-customer-2", email: "new-session@example.test" },
  });
  revokeSessionMock.mockResolvedValue(undefined);
  clearAuthSessionMock.mockResolvedValue(undefined);
  saveAuthSessionMock.mockResolvedValue(undefined);
});

afterEach(async () => {
  if (renderer) {
    await act(async () => renderer?.unmount());
    renderer = null;
  }
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: originalFetch,
  });
});

describe("Financial Advice authentication through AuthProvider and protected routes", () => {
  it("renders the real FA route and submits through requestJson to the HTTP transport", async () => {
    installFetch(async () => makeResponse(200, successfulAdviceResponse));
    const root = await renderFinancialAdviceRoute();

    expect(collectText(findByTestId(root, "fa-auth-state"))).toBe("authenticated:true");
    expect(root.root.findAllByProps({ testID: "fa-income" }).length).toBeGreaterThan(0);

    await fillAndSubmitSavingsForm(root);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [requestUrl, requestInit] = fetchMock.mock.calls[0]!;
    expect(String(requestUrl)).toContain("/assistant/financial-advice");
    expect(requestInit?.method).toBe("POST");
    expect((requestInit?.headers as Record<string, string>).Authorization).toBe(
      "Bearer synthetic-refreshed-access-token",
    );
    expect(root.root.findAllByProps({ testID: "fa-result" }).length).toBeGreaterThan(0);
    await act(async () => root.unmount());
    renderer = null;
  });

  it("shows the final 401 and sends the user through real logout to the protected login route", async () => {
    installFetch(async () => makeResponse(401, apiUnauthorizedPayload));
    const root = await renderFinancialAdviceRoute();
    await fillAndSubmitSavingsForm(root);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(root.root.findAllByProps({ testID: "fa-error" }).length).toBeGreaterThan(0);
    expect(collectText(findByTestId(root, "fa-error"))).toContain("Phiên đăng nhập hết hạn");
    expect(findByTestId(root, "fa-relogin-button", "onPress")).toBeDefined();

    await act(async () => {
      findByTestId(root, "fa-relogin-button", "onPress").props.onPress();
      await flushAsyncWork(8);
    });

    expect(revokeSessionMock).toHaveBeenCalledTimes(1);
    expect(clearAuthSessionMock).toHaveBeenCalledTimes(1);
    expect(root.root.findAllByProps({ testID: "login-route-screen" }).length).toBeGreaterThan(0);
    expect(collectText(findByTestId(root, "fa-auth-state"))).toBe("anonymous:false");
    expect(root.root.findAllByProps({ testID: "fa-income" })).toHaveLength(0);
  });

  it("ignores an old pending 401 after AuthProvider switches to a new session", async () => {
    let resolveOldResponse!: (response: Response) => void;
    installFetch(
      () => new Promise<Response>((resolve) => {
        resolveOldResponse = resolve;
      }),
    );
    const root = await renderFinancialAdviceRoute();
    await fillAndSubmitSavingsForm(root);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      findByTestId(root, "fa-switch-session", "onPress").props.onPress();
      await flushAsyncWork(6);
    });
    expect(loginMock).toHaveBeenCalledTimes(1);
    expect(collectText(findByTestId(root, "fa-auth-state"))).toBe("authenticated:true");

    await act(async () => {
      resolveOldResponse(makeResponse(401, apiUnauthorizedPayload));
      await flushAsyncWork(5);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refreshSessionMock).toHaveBeenCalledTimes(1);
    expect(clearAuthSessionMock).not.toHaveBeenCalled();
    expect(revokeSessionMock).not.toHaveBeenCalled();
    expect(collectText(findByTestId(root, "fa-auth-state"))).toBe("authenticated:true");
    expect(root.root.findAllByProps({ testID: "login-route-screen" })).toHaveLength(0);
  });
});
