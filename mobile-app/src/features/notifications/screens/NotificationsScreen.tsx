import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "expo-router";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { AppHeader } from "@/components/ui/AppHeader";
import { AppIcon, type AppIconName } from "@/components/ui/AppIcon";
import { Screen } from "@/components/ui/Screen";
import { StateCard } from "@/components/ui/StateCard";
import { useAuth } from "@/features/auth/context/AuthContext";
import {
  listNotifications,
  markNotificationRead,
} from "@/features/notifications/services/notificationsApi";
import type {
  Notification,
  NotificationType,
} from "@/features/notifications/types/notification";
import { ApiError } from "@/services/api/ApiError";
import { colors, radius, shadows, sizes, spacing, typography } from "@/theme";

export type NotificationFilter = "ALL" | "UNREAD" | NotificationType;

const notificationFilters: { value: NotificationFilter; label: string }[] = [
  { value: "ALL", label: "Tất cả" },
  { value: "UNREAD", label: "Chưa đọc" },
  { value: "TRANSFER", label: "Chuyển tiền" },
  { value: "SAVINGS", label: "Tiết kiệm" },
  { value: "CREDIT", label: "Tín dụng" },
  { value: "SECURITY", label: "Bảo mật" },
];

function getErrorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "Không thể tải thông báo. Vui lòng thử lại.";
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("vi-VN");
}

function getNotificationIcon(type: NotificationType): AppIconName {
  if (type === "TRANSFER") return "transfer";
  if (type === "SAVINGS") return "savings";
  if (type === "CREDIT") return "card";
  return "shield";
}

export function NotificationsScreen() {
  const router = useRouter();
  const { deviceId, refreshAccessToken, session } = useAuth();
  const accessToken = session?.accessToken ?? null;
  const auth = useMemo(
    () => ({ accessToken, deviceId, refreshAccessToken }),
    [accessToken, deviceId, refreshAccessToken],
  );
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [filter, setFilter] = useState<NotificationFilter>("ALL");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const loadNotifications = useCallback(
    async (isManualRefresh = false) => {
      if (!accessToken) {
        setIsLoading(false);
        setIsRefreshing(false);
        return;
      }
      if (isManualRefresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError(undefined);
      try {
        const response = await listNotifications(auth);
        setNotifications(response.items);
      } catch (requestError: unknown) {
        setError(getErrorMessage(requestError));
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [accessToken, auth],
  );

  useEffect(() => {
    void Promise.resolve().then(() => loadNotifications());
  }, [loadNotifications]);

  const handleRefresh = useCallback(() => {
    void loadNotifications(true);
  }, [loadNotifications]);

  const handleOpen = useCallback(
    async (notification: Notification) => {
      let nextNotification = notification;
      if (!notification.read) {
        try {
          const updated = await markNotificationRead(notification.id, auth);
          nextNotification = updated;
          setNotifications((current) =>
            current.map((item) => (item.id === updated.id ? updated : item)),
          );
        } catch (requestError: unknown) {
          setError(getErrorMessage(requestError));
          return;
        }
      }

      router.push({
        pathname: "/notifications/[notificationId]",
        params: { notificationId: nextNotification.id },
      });
    },
    [auth, router],
  );

  const unreadCount = useMemo(
    () => notifications.filter((item) => !item.read).length,
    [notifications],
  );

  const visibleNotifications = useMemo(() => {
    return notifications.filter((item) => {
      if (filter === "ALL") return true;
      if (filter === "UNREAD") return !item.read;
      return item.type === filter;
    });
  }, [filter, notifications]);

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            colors={[colors.primary]}
            onRefresh={handleRefresh}
            refreshing={isRefreshing}
            tintColor={colors.primary}
          />
        }
      >
        <AppHeader
          eyebrow="Trung tâm cập nhật"
          onBack={() => router.back()}
          subtitle={
            unreadCount > 0
              ? `Bạn có ${unreadCount} thông báo chưa đọc.`
              : "Các cập nhật quan trọng về tài khoản và giao dịch."
          }
          title="Thông báo"
        />

        {notifications.length > 0 && !error ? (
          <ScrollView
            contentContainerStyle={styles.filterRow}
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.filterScrollView}
            testID="notification-filters"
          >
            {notificationFilters.map((item) => {
              const selected = filter === item.value;
              const badgeCount =
                item.value === "UNREAD" ? unreadCount : undefined;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  key={item.value}
                  onPress={() => setFilter(item.value)}
                  style={[
                    styles.filterChip,
                    selected ? styles.filterChipSelected : null,
                  ]}
                  testID={`notification-filter-${item.value.toLowerCase()}`}
                >
                  <Text
                    style={[
                      styles.filterChipLabel,
                      selected ? styles.filterChipLabelSelected : null,
                    ]}
                  >
                    {item.label}
                    {badgeCount !== undefined && badgeCount > 0
                      ? ` (${badgeCount})`
                      : ""}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        {isLoading ? (
          <StateCard loading message="Đang tải thông báo..." />
        ) : error ? (
          <StateCard
            actionLabel="Thử lại"
            icon="alert"
            message={error}
            onAction={() => void loadNotifications()}
            title="Không thể tải thông báo"
          />
        ) : notifications.length === 0 ? (
          <StateCard
            icon="bell"
            message="Khi có cập nhật về giao dịch hoặc bảo mật, bạn sẽ thấy tại đây."
            title="Chưa có thông báo"
          />
        ) : visibleNotifications.length === 0 ? (
          <StateCard
            icon="bell"
            message="Không có thông báo nào trong danh mục đã chọn."
            title="Không tìm thấy thông báo"
          />
        ) : (
          <View style={styles.list}>
            {visibleNotifications.map((notification, index) => (
              <Pressable
                accessibilityLabel={`Mở thông báo ${notification.title}`}
                accessibilityRole="button"
                key={notification.id}
                onPress={() => void handleOpen(notification)}
                style={({ pressed }) => [
                  styles.notificationCard,
                  !notification.read ? styles.unreadCard : null,
                  pressed ? styles.pressed : null,
                ]}
                testID={
                  index === 0 ? "notification-first" : `notification-${notification.id}`
                }
              >
                <View
                  style={[
                    styles.iconBox,
                    !notification.read ? styles.unreadIconBox : null,
                  ]}
                >
                  <AppIcon
                    color={!notification.read ? colors.primary : colors.muted}
                    name={getNotificationIcon(notification.type)}
                    size={21}
                  />
                </View>
                <View style={styles.notificationContent}>
                  <View style={styles.titleRow}>
                    <Text numberOfLines={1} style={styles.notificationTitle}>
                      {notification.title}
                    </Text>
                    {!notification.read ? <View style={styles.unreadDot} /> : null}
                  </View>
                  <Text numberOfLines={2} style={styles.notificationBody}>
                    {notification.body}
                  </Text>
                  <Text style={styles.notificationDate}>
                    {formatDate(notification.createdAt)}
                  </Text>
                </View>
                <AppIcon color={colors.subtle} name="chevronRight" size={19} />
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    width: "100%",
    maxWidth: sizes.contentMaxWidth,
    alignSelf: "center",
    padding: spacing.lg,
    gap: spacing.lg,
  },
  filterScrollView: {
    flexGrow: 0,
    maxHeight: 44,
  },
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: 2,
  },
  filterChip: {
    height: 36,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  filterChipSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  filterChipLabel: {
    ...typography.caption,
    color: colors.muted,
    fontWeight: "600",
  },
  filterChipLabelSelected: {
    color: colors.primary,
    fontWeight: "700",
  },
  list: { gap: spacing.sm },
  notificationCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  unreadCard: { borderColor: colors.primarySoft, backgroundColor: "#FAFCFF" },
  pressed: { opacity: 0.78, transform: [{ scale: 0.995 }] },
  iconBox: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  unreadIconBox: { backgroundColor: colors.primarySoft },
  notificationContent: { flex: 1, gap: spacing.xs },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  notificationTitle: { flex: 1, ...typography.bodyStrong, color: colors.text },
  notificationBody: { ...typography.body, color: colors.muted },
  notificationDate: { ...typography.caption, color: colors.subtle },
  unreadDot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: colors.primary },
});
