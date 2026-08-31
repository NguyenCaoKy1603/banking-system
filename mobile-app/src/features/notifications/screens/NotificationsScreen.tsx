import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

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
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  const loadNotifications = useCallback(async () => {
    if (!accessToken) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(undefined);
    try {
      const response = await listNotifications(auth);
      setNotifications(response.items);
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsLoading(false);
    }
  }, [accessToken, auth]);

  useEffect(() => {
    void Promise.resolve().then(() => loadNotifications());
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

  const unreadCount = notifications.filter((item) => !item.read).length;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
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

        {isLoading ? (
          <StateCard loading message="Đang tải thông báo..." />
        ) : error ? (
          <StateCard
            actionLabel="Thử lại"
            icon="alert"
            message={error}
            onAction={loadNotifications}
            title="Không thể tải thông báo"
          />
        ) : notifications.length === 0 ? (
          <StateCard
            icon="bell"
            message="Khi có cập nhật về giao dịch hoặc bảo mật, bạn sẽ thấy tại đây."
            title="Chưa có thông báo"
          />
        ) : (
          <View style={styles.list}>
            {notifications.map((notification, index) => (
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
                testID={index === 0 ? "notification-first" : `notification-${notification.id}`}
              >
                <View style={[styles.iconBox, !notification.read ? styles.unreadIconBox : null]}>
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
                  <Text style={styles.notificationDate}>{formatDate(notification.createdAt)}</Text>
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
