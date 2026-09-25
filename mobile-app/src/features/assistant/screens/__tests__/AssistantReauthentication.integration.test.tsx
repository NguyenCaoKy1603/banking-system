import { ExpoRoot } from "expo-router/build/ExpoRoot";
import { router, Stack } from "expo-router";
import { inMemoryContext } from "expo-router/build/testing-library/context-stubs";
import { AppState, Text, View } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { AssistantScreen } from "@/features/assistant/screens/AssistantScreen";
import * as assistantApi from "@/features/assistant/api/assistantApi";
import * as authApi from "@/features/auth/services/authApi";
import { AuthProvider, useAuth } from "@/features/auth/context/AuthContext";
import * as authSessionStorage from "@/features/auth/storage/authSessionStorage";
import * as deviceBindingStorage from "@/features/auth/storage/deviceBindingStorage";
import { ApiError } from "@/services/api/ApiError";

jest.mock("@/features/assistant/api/assistantApi", () => ({
  askAssistantHelp: jest.fn(),
}));

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

const askAssistantHelpMock = jest.mocked(assistantApi.askAssistantHelp);
const refreshSessionMock = jest.mocked(authApi.refreshSession);
const revokeSessionMock = jest.mocked(authApi.revokeSession);
const loadAuthSessionMock = jest.mocked(authSessionStorage.loadAuthSession);
const clearAuthSessionMock = jest.mocked(authSessionStorage.clearAuthSession);
const loadDeviceBindingIdMock = jest.mocked(deviceBindingStorage.loadDeviceBindingId);

const storedSession = {
  accessToken: "integration-access-token",
  refreshToken: "integration-refresh-token",
  accessTokenExpiresAt: Date.now() + 900_000,
  sessionEpoch: "integration-session-epoch",
  user: {
    id: "integration-user",
    fullName: "Người dùng kiểm thử",
    email: "integration@example.com",
    phoneNumber: "0900000000",
    createdAt: "2026-01-01T00:00:00Z",
  },
};

beforeAll(() => {
  Object.defineProperty(AppState, "currentState", {
    configurable: true,
    value: "active",
  });
});

function AssistantRoute() {
  const { isAuthenticated, status } = useAuth();
  return (
    <>
      <Text testID="route-auth-state">{`${status}:${isAuthenticated}`}</Text>
      <AssistantScreen />
    </>
  );
}

function LoginRoute() {
  return <Text testID="login-route-screen">Login route is active</Text>;
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
          <Stack.Screen name="assistant" />
        </Stack.Protected>
      </Stack>
    </View>
  );
}

function RootRouteLayout() {
  return (
    <AuthProvider>
      <ProtectedRoutes />
    </AuthProvider>
  );
}

function findByTestId(renderer: ReactTestRenderer, testID: string, handlerName?: string) {
  const matches = renderer.root.findAllByProps({ testID });
  const match = handlerName
    ? matches.find((node) => typeof node.props[handlerName] === "function")
    : matches[0];
  if (!match) throw new Error(`Expected route testID and handler: ${testID}`);
  return match;
}

describe("Assistant reauthentication with real auth state and Expo protected routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    loadAuthSessionMock.mockResolvedValue(storedSession);
    loadDeviceBindingIdMock.mockResolvedValue("integration-device-id");
    refreshSessionMock.mockResolvedValue({
      accessToken: "refreshed-access-token",
      refreshToken: "refreshed-refresh-token",
      expiresInSeconds: 900,
      user: storedSession.user,
    });
    revokeSessionMock.mockResolvedValue(undefined);
    clearAuthSessionMock.mockResolvedValue(undefined);
    askAssistantHelpMock.mockRejectedValue(new ApiError({
      status: 401,
      code: "UNAUTHORIZED",
      message: "Access token is invalid or expired.",
    }));
  });

  it("clears the authenticated session and the actual Stack.Protected guard opens login", async () => {
    process.env.EXPO_ROUTER_IMPORT_MODE = "sync";
    const context = inMemoryContext({
      "_layout": RootRouteLayout,
      assistant: AssistantRoute,
      login: LoginRoute,
    });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<ExpoRoot context={context} location="/assistant" />);
      for (let tick = 0; tick < 5; tick += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    });

    expect(refreshSessionMock).toHaveBeenCalledTimes(1);
    await act(async () => router.replace("/assistant"));
    expect(findByTestId(renderer, "route-auth-state").props.children).toBe("authenticated:true");

    await act(async () => {
      findByTestId(renderer, "assistant-question-input", "onChangeText").props.onChangeText("Hướng dẫn đăng nhập lại");
    });
    await act(async () => {
      findByTestId(renderer, "assistant-send-button", "onPress").props.onPress();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(renderer.root.findAllByProps({ testID: "assistant-relogin-button" }).length).toBeGreaterThan(0);

    await act(async () => {
      findByTestId(renderer, "assistant-relogin-button", "onPress").props.onPress();
      for (let tick = 0; tick < 5; tick += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        await Promise.resolve();
      }
    });

    expect(clearAuthSessionMock).toHaveBeenCalledTimes(1);
    expect(revokeSessionMock).toHaveBeenCalledTimes(1);
    expect(renderer.root.findAllByProps({ testID: "login-route-screen" }).length).toBeGreaterThan(0);
    await act(async () => renderer.unmount());
  });
});
