import type { ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { NotificationsScreen } from "@/features/notifications/screens/NotificationsScreen";
import { useAuth } from "@/features/auth/context/AuthContext";
import * as notificationsApi from "@/features/notifications/services/notificationsApi";
import type { Notification } from "@/features/notifications/types/notification";

const mockBack = jest.fn();
const mockPush = jest.fn();

jest.mock("expo-router", () => ({
  Link: ({ children }: { children: ReactNode }) => children,
  useRouter: () => ({ back: mockBack, push: mockPush }),
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: jest.fn(),
}));

jest.mock("@/features/notifications/services/notificationsApi");

const useAuthMock = jest.mocked(useAuth);
const listNotificationsMock = jest.mocked(notificationsApi.listNotifications);
const markNotificationReadMock = jest.mocked(notificationsApi.markNotificationRead);

const mockNotifications: Notification[] = [
  {
    id: "notif-1",
    type: "TRANSFER",
    title: "Chuyển tiền thành công",
    body: "Giao dịch 500.000 VND đã hoàn tất",
    resourceId: "tx-1",
    resourceAccountId: "acc-1",
    read: false,
    createdAt: "2026-08-20T10:00:00Z",
  },
  {
    id: "notif-2",
    type: "SAVINGS",
    title: "Mở tiết kiệm thành công",
    body: "Khoản tiết kiệm 10.000.000 VND đã được mở",
    resourceId: "dep-1",
    resourceAccountId: "acc-1",
    read: true,
    createdAt: "2026-08-19T10:00:00Z",
  },
  {
    id: "notif-3",
    type: "SECURITY",
    title: "Cảnh báo đăng nhập mới",
    body: "Tài khoản vừa đăng nhập trên thiết bị mới",
    resourceId: null,
    resourceAccountId: null,
    read: false,
    createdAt: "2026-08-18T10:00:00Z",
  },
];

const mockSession = {
  accessToken: "token-abc",
  refreshToken: "refresh-abc",
  accessTokenExpiresAt: Date.now() + 900_000,
  sessionEpoch: "epoch-1",
  user: {
    id: "user-1",
    fullName: "Nguyễn Văn A",
    email: "vana@example.com",
    phoneNumber: "0901234567",
    createdAt: "2026-01-01T00:00:00Z",
  },
};

function authState() {
  return {
    deviceId: "device-1",
    session: mockSession,
    status: "authenticated" as const,
    isAuthenticated: true,
    logoutNotice: null,
    pendingRecoveryCodes: null,
    refreshAccessToken: jest.fn(),
    logout: jest.fn(),
    login: jest.fn(),
    register: jest.fn(),
    submitOtp: jest.fn(),
    requestOtp: jest.fn(),
    completeTotpEnrollment: jest.fn(),
    verifyRegistrationChallenge: jest.fn(),
    resendRegistrationChallenge: jest.fn(),
    completeMfaRevocation: jest.fn(),
    clearPendingRecoveryCodes: jest.fn(),
    logoutAll: jest.fn(),
    bootstrap: jest.fn(),
  };
}

describe("NotificationsScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthMock.mockReturnValue(authState());
    listNotificationsMock.mockResolvedValue({ items: mockNotifications });
  });

  it("tải và hiển thị danh sách thông báo cùng bộ lọc", async () => {
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<NotificationsScreen />);
    });

    const root = renderer!.root;
    expect(listNotificationsMock).toHaveBeenCalledTimes(1);

    // Kiểm tra render filter chips
    const filterContainer = root.findByProps({ testID: "notification-filters" });
    expect(filterContainer).toBeTruthy();

    // Kiểm tra render các items
    const firstNotif = root.findByProps({ testID: "notification-first" });
    expect(firstNotif).toBeTruthy();
  });

  it("lọc danh sách khi chọn tab 'Chưa đọc'", async () => {
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<NotificationsScreen />);
    });

    const root = renderer!.root;

    // Bấm vào chip 'Chưa đọc'
    const unreadFilter = root.findByProps({ testID: "notification-filter-unread" });
    await act(async () => {
      unreadFilter.props.onPress();
    });

    // notif-1 và notif-3 là chưa đọc
    expect(root.findByProps({ testID: "notification-first" })).toBeTruthy();
    expect(root.findByProps({ testID: "notification-notif-3" })).toBeTruthy();
  });

  it("lọc danh sách theo loại 'SAVINGS' và 'CREDIT'", async () => {
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<NotificationsScreen />);
    });

    const root = renderer!.root;

    // Chọn SAVINGS
    const savingsFilter = root.findByProps({ testID: "notification-filter-savings" });
    await act(async () => {
      savingsFilter.props.onPress();
    });
    expect(root.findByProps({ testID: "notification-first" })).toBeTruthy();

    // Chọn CREDIT (danh sách không có thẻ CREDIT)
    const creditFilter = root.findByProps({ testID: "notification-filter-credit" });
    await act(async () => {
      creditFilter.props.onPress();
    });
    const emptyNotice = root.findByProps({
      message: "Không có thông báo nào trong danh mục đã chọn.",
    });
    expect(emptyNotice).toBeTruthy();
  });

  it("hỗ trợ kéo để làm mới qua RefreshControl", async () => {
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<NotificationsScreen />);
    });

    const root = renderer!.root;
    const refreshControl = root.findByProps({ refreshing: false });
    expect(refreshControl).toBeTruthy();

    // Kích hoạt onRefresh
    await act(async () => {
      refreshControl.props.onRefresh();
    });

    expect(listNotificationsMock).toHaveBeenCalledTimes(2);
  });

  it("đánh dấu đã đọc và điều hướng khi bấm vào thông báo chưa đọc", async () => {
    const updatedNotif = { ...mockNotifications[0], read: true };
    markNotificationReadMock.mockResolvedValue(updatedNotif);

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<NotificationsScreen />);
    });

    const root = renderer!.root;
    const firstNotif = root.findByProps({ testID: "notification-first" });

    await act(async () => {
      firstNotif.props.onPress();
    });

    expect(markNotificationReadMock).toHaveBeenCalledWith(
      "notif-1",
      expect.objectContaining({ accessToken: "token-abc" }),
    );
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/notifications/[notificationId]",
      params: { notificationId: "notif-1" },
    });
  });
});
