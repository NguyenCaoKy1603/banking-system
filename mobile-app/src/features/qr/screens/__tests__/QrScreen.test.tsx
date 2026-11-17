import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { AppState, type AppStateStatus, Linking } from "react-native";

import { QrScreen } from "@/features/qr/screens/QrScreen";
import { useAuth } from "@/features/auth/context/AuthContext";
import { getAccountNumber, listAccounts } from "@/features/accounts/services/accountsApi";
import { createReceiveQrPayload } from "@/features/qr/validation/qrPayload";

const mockBack = jest.fn();
const mockPush = jest.fn();
const mockRequestPermission = jest.fn();
const mockGetPermission = jest.fn();

let mockPermissionState: {
  granted: boolean;
  canAskAgain: boolean;
  status: string;
  expires: string;
} | null = null;

jest.mock("expo-router", () => ({
  useIsFocused: () => true,
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ back: mockBack, push: mockPush }),
}));

jest.mock("expo-camera", () => ({
  CameraView: "CameraView",
  useCameraPermissions: () => [
    mockPermissionState,
    mockRequestPermission,
    mockGetPermission,
  ],
}));

jest.mock("expo-clipboard", () => ({
  setStringAsync: jest.fn(),
}));

jest.mock("react-native-qrcode-svg", () => "QRCode");

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: jest.fn(),
}));

jest.mock("@/features/accounts/services/accountsApi", () => ({
  listAccounts: jest.fn(),
  getAccountNumber: jest.fn(),
}));

const useAuthMock = jest.mocked(useAuth);
const listAccountsMock = jest.mocked(listAccounts);
const getAccountNumberMock = jest.mocked(getAccountNumber);

let renderer: ReactTestRenderer | null = null;

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function findNode(root: ReactTestRenderer, testID: string, handler?: string) {
  const nodes = root.root.findAllByProps({ testID });
  const match = handler
    ? nodes.find((node) => typeof node.props[handler] === "function")
    : nodes[0];
  if (!match) {
    throw new Error(`Node not found for testID=${testID}`);
  }
  return match;
}

describe("QrScreen camera scanning flow", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPermissionState = {
      granted: false,
      canAskAgain: true,
      status: "undetermined",
      expires: "never",
    };
    useAuthMock.mockReturnValue({
      status: "authenticated",
      isAuthenticated: true,
      deviceId: "device-1",
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
      session: {
        accessToken: "token-1",
        refreshToken: "refresh-1",
        accessTokenExpiresAt: Date.now() + 900_000,
        sessionEpoch: "epoch-1",
        user: {
          id: "user-1",
          fullName: "Nguyen Cao Ky",
          email: "ky@example.com",
          phoneNumber: "0900000001",
          createdAt: "2026-01-01T00:00:00Z",
        },
      },
    });
    listAccountsMock.mockResolvedValue({
      accounts: [
        {
          id: "acc-1",
          displayName: "Tài khoản chính",
          maskedNumber: "•••• 0010",
          bankName: "NOVA",
          currency: "VND",
          heldAmount: { amountMinor: "0", currency: "VND" },
          availableBalance: { amountMinor: "1000000", currency: "VND" },
          currentBalance: { amountMinor: "1000000", currency: "VND" },
          status: "ACTIVE",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ],
    });
    getAccountNumberMock.mockResolvedValue({
      accountNumber: "9704100000010",
    });
  });

  afterEach(() => {
    if (renderer) {
      act(() => {
        renderer?.unmount();
      });
      renderer = null;
    }
    jest.restoreAllMocks();
  });

  it("tự động xin quyền và mở camera ngay khi bấm sang tab Quét QR", async () => {
    mockRequestPermission.mockResolvedValueOnce({
      granted: true,
      canAskAgain: true,
      status: "granted",
      expires: "never",
    });

    await act(async () => {
      renderer = create(<QrScreen />);
    });
    await flushMicrotasks();

    await act(async () => {
      findNode(renderer!, "qr-scan", "onPress").props.onPress();
    });
    await flushMicrotasks();

    expect(mockRequestPermission).toHaveBeenCalledTimes(1);

    // Giả lập hook trả về permission.granted = true sau khi user đồng ý
    mockPermissionState = {
      granted: true,
      canAskAgain: true,
      status: "granted",
      expires: "never",
    };
    await act(async () => {
      renderer!.update(<QrScreen />);
    });
    await flushMicrotasks();

    expect(renderer!.root.findAllByProps({ testID: "qr-camera" }).length).toBeGreaterThan(0);
    const camera = findNode(renderer!, "qr-camera");
    expect(camera.props.facing).toBe("back");
  });

  it("mở thẳng camera nếu quyền đã được cấp trước đó mà không hỏi lại", async () => {
    mockPermissionState = {
      granted: true,
      canAskAgain: true,
      status: "granted",
      expires: "never",
    };

    await act(async () => {
      renderer = create(<QrScreen />);
    });
    await flushMicrotasks();

    await act(async () => {
      findNode(renderer!, "qr-scan", "onPress").props.onPress();
    });
    await flushMicrotasks();

    expect(mockRequestPermission).not.toHaveBeenCalled();
    expect(renderer!.root.findAllByProps({ testID: "qr-camera" }).length).toBeGreaterThan(0);
  });

  it("hiển thị nút Mở Cài đặt ứng dụng khi quyền Camera bị chặn (canAskAgain = false)", async () => {
    mockPermissionState = {
      granted: false,
      canAskAgain: false,
      status: "denied",
      expires: "never",
    };
    const openSettingsSpy = jest.spyOn(Linking, "openSettings").mockResolvedValueOnce();
    const addListenerSpy = jest.spyOn(AppState, "addEventListener");

    await act(async () => {
      renderer = create(<QrScreen />);
    });
    await flushMicrotasks();

    await act(async () => {
      findNode(renderer!, "qr-scan", "onPress").props.onPress();
    });
    await flushMicrotasks();

    expect(mockRequestPermission).not.toHaveBeenCalled();
    const openSettingsBtn = findNode(renderer!, "qr-open-settings", "onPress");
    await act(async () => {
      await openSettingsBtn.props.onPress();
    });
    expect(openSettingsSpy).toHaveBeenCalledTimes(1);
    openSettingsSpy.mockRestore();

    // Khi quay lại từ Cài đặt OS (AppState -> active), app kiểm tra lại quyền và tự mở camera
    const changeCalls = addListenerSpy.mock.calls.filter(([type]) => type === "change");
    const changeListener = changeCalls[changeCalls.length - 1]?.[1] as
      | ((state: AppStateStatus) => void)
      | undefined;
    expect(changeListener).toBeDefined();

    mockGetPermission.mockResolvedValueOnce({
      granted: true,
      canAskAgain: true,
      status: "granted",
      expires: "never",
    });
    mockPermissionState = {
      granted: true,
      canAskAgain: true,
      status: "granted",
      expires: "never",
    };

    await act(async () => {
      changeListener!("active");
    });
    await flushMicrotasks();
    await act(async () => {
      renderer!.update(<QrScreen />);
    });
    await flushMicrotasks();

    expect(mockGetPermission).toHaveBeenCalled();
    expect(renderer!.root.findAllByProps({ testID: "qr-camera" }).length).toBeGreaterThan(0);
    addListenerSpy.mockRestore();
  });

  it("giữ ranh giới D-20 khi quét mã QR người khác và mở lại camera khi bấm Quét mã khác", async () => {
    mockPermissionState = {
      granted: true,
      canAskAgain: true,
      status: "granted",
      expires: "never",
    };

    await act(async () => {
      renderer = create(<QrScreen />);
    });
    await flushMicrotasks();

    await act(async () => {
      findNode(renderer!, "qr-scan", "onPress").props.onPress();
    });
    await flushMicrotasks();

    const otherPayload = createReceiveQrPayload({
      accountNumber: "970400000001",
      displayName: "Tran Van Binh",
      maskedAccountNumber: "•••• 0001",
      bankName: "NOVA",
    });

    await act(async () => {
      findNode(renderer!, "qr-camera", "onBarcodeScanned").props.onBarcodeScanned({
        type: "qr",
        data: otherPayload,
      });
    });
    await flushMicrotasks();

    expect(renderer!.root.findAllByProps({ testID: "qr-valid-payload" }).length).toBeGreaterThan(0);
    expect(renderer!.root.findAllByProps({ testID: "qr-transfer-blocked" }).length).toBeGreaterThan(0);
    expect(renderer!.root.findAllByProps({ testID: "qr-continue-transfer" }).length).toBeGreaterThan(0);

    await act(async () => {
      findNode(renderer!, "qr-reset", "onPress").props.onPress();
    });
    await flushMicrotasks();

    expect(renderer!.root.findAllByProps({ testID: "qr-camera" }).length).toBeGreaterThan(0);
  });
});
