import type { ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { ListRow } from "@/components/ui/ListRow";
import { HomeScreen } from "@/features/home/screens/HomeScreen";
import { useAuth } from "@/features/auth/context/AuthContext";
import * as accountsApi from "@/features/accounts/services/accountsApi";

const mockPush = jest.fn();
const mockReplace = jest.fn();

jest.mock("expo-router", () => {
  const React = jest.requireActual("react");
  return {
    Link: ({ children }: { children: ReactNode }) => children,
    useRouter: () => ({ push: mockPush, replace: mockReplace }),
    useFocusEffect: (cb: () => void) => {
      React.useEffect(() => {
        cb();
      }, [cb]);
    },
  };
});

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: jest.fn(),
}));

jest.mock("@/features/accounts/services/accountsApi");

const useAuthMock = jest.mocked(useAuth);
const listAccountsMock = jest.mocked(accountsApi.listAccounts);

const mockSession = {
  accessToken: "access-token-home",
  refreshToken: "refresh-token-home",
  accessTokenExpiresAt: Date.now() + 900_000,
  sessionEpoch: "epoch-1",
  user: {
    id: "user-home-1",
    fullName: "Trần Văn B",
    email: "vanb@example.com",
    phoneNumber: "0909999999",
    createdAt: "2026-01-01T00:00:00Z",
  },
};

describe("HomeScreen — Assistant Entry Point", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthMock.mockReturnValue({
      deviceId: "device-home-1",
      session: mockSession,
      status: "authenticated",
      isAuthenticated: true,
      logoutNotice: null,
      pendingRecoveryCodes: null,
      refreshAccessToken: jest.fn(),
      login: jest.fn(),
      register: jest.fn(),
      verifyRegistrationChallenge: jest.fn(),
      resendRegistrationChallenge: jest.fn(),
      completeMfaRevocation: jest.fn(),
      clearPendingRecoveryCodes: jest.fn(),
      logout: jest.fn(),
      logoutAll: jest.fn(),
    });
    listAccountsMock.mockResolvedValue({ accounts: [] });
  });

  it("hiển thị đúng một điểm truy cập Trợ lý hướng dẫn NOVA trên HomeScreen và điều hướng tới /assistant", async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<HomeScreen />);
    });

    const listRows = renderer.root.findAllByType(ListRow);
    const assistantRows = listRows.filter(
      (node) => node.props.testID === "home-assistant-entry",
    );

    // Chỉ có đúng 1 điểm truy cập
    expect(assistantRows.length).toBe(1);

    const entry = assistantRows[0];
    expect(entry.props.title).toBe("Trợ lý hướng dẫn NOVA");
    expect(entry.props.subtitle).toBe("Hỏi đáp về cách sử dụng ứng dụng");

    // Bấm vào điểm truy cập mở route /assistant
    await act(async () => {
      entry.props.onPress();
    });

    expect(mockPush).toHaveBeenCalledWith("/assistant");
  });
});
