import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { Screen } from "@/components/ui/Screen";
import { useAuth } from "@/features/auth/context/AuthContext";
import { listNotifications, markNotificationRead } from "@/features/notifications/services/notificationsApi";
import type { Notification } from "@/features/notifications/types/notification";
import { ApiError } from "@/services/api/ApiError";
import { colors, spacing } from "@/theme";

function getErrorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "Không thể tải thông báo. Vui lòng thử lại.";
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("vi-VN");
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

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Text style={styles.backLabel}>‹ Quay lại</Text>
        </Pressable>

        <View style={styles.header}>
          <Text style={styles.eyebrow}>THÔNG BÁO</Text>
          <Text style={styles.title}>Thông báo giao dịch</Text>
          <Text style={styles.description}>
            Thông báo do server ghi nhận; không chứa token hay thông tin xác thực.
          </Text>
        </View>

        {isLoading ? (
          <View style={styles.centerState}>
            <ActivityIndicator color={colors.primary} size="large" />
          </View>
        ) : error ? (
          <View style={styles.stateCard}>
            <Text style={styles.errorText}>{error}</Text>
            <PrimaryButton label="Thử lại" onPress={loadNotifications} />
          </View>
        ) : notifications.length === 0 ? (
          <View style={styles.stateCard}>
          <Text style={styles.emptyState}>Chưa có thông báo mới.</Text>
          </View>
        ) : (
          <View style={styles.listCard}>
            {notifications.map((notification, index) => (
              <Pressable
                accessibilityRole="button"
                key={notification.id}
                onPress={() => void handleOpen(notification)}
                testID={index === 0 ? "notification-first" : `notification-${notification.id}`}
                style={({ pressed }) => [
                  styles.notificationRow,
                  !notification.read ? styles.unreadRow : null,
                  pressed ? styles.pressedRow : null,
                ]}
              >
                <View style={styles.notificationContent}>
                  <Text style={styles.notificationTitle}>{notification.title}</Text>
                  <Text style={styles.notificationBody}>{notification.body}</Text>
                  <Text style={styles.notificationDate}>
                    {formatDate(notification.createdAt)}
                  </Text>
                </View>
                {!notification.read ? <View style={styles.unreadDot} /> : null}
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
    maxWidth: 720,
    alignSelf: "center",
    padding: spacing.lg,
    gap: spacing.lg,
  },
  backButton: {
    alignSelf: "flex-start",
    paddingVertical: spacing.xs,
  },
  backLabel: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: "600",
  },
  header: {
    gap: spacing.sm,
  },
  eyebrow: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.4,
  },
  title: {
    color: colors.text,
    fontSize: 30,
    fontWeight: "700",
  },
  description: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  centerState: {
    minHeight: 160,
    alignItems: "center",
    justifyContent: "center",
  },
  stateCard: {
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing.md,
    backgroundColor: colors.surface,
  },
  emptyState: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "600",
  },
  errorText: {
    color: colors.danger,
    fontSize: 14,
    lineHeight: 20,
  },
  listCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing.md,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  notificationRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  unreadRow: {
    backgroundColor: colors.background,
  },
  pressedRow: {
    opacity: 0.72,
  },
  notificationContent: {
    flex: 1,
    gap: spacing.xs,
  },
  notificationTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  notificationBody: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  notificationDate: {
    color: colors.muted,
    fontSize: 12,
  },
  unreadDot: {
    width: spacing.sm,
    height: spacing.sm,
    borderRadius: spacing.xs,
    backgroundColor: colors.primary,
  },
});
