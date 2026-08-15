import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
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
import { getNotificationRoute } from "@/features/notifications/navigation/notificationRoute";
import {
  listNotifications,
  markNotificationRead,
} from "@/features/notifications/services/notificationsApi";
import type { Notification } from "@/features/notifications/types/notification";
import { ApiError } from "@/services/api/ApiError";
import { colors, spacing } from "@/theme";

function getErrorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "Không thể tải chi tiết thông báo. Vui lòng thử lại.";
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("vi-VN");
}

export function NotificationDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ notificationId?: string }>();
  const { deviceId, refreshAccessToken, session } = useAuth();
  const accessToken = session?.accessToken ?? null;
  const notificationId =
    typeof params.notificationId === "string" ? params.notificationId : "";
  const auth = useMemo(
    () => ({ accessToken, deviceId, refreshAccessToken }),
    [accessToken, deviceId, refreshAccessToken],
  );
  const [notification, setNotification] = useState<Notification | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  const loadNotification = useCallback(async () => {
    if (!accessToken || !notificationId) {
      setNotification(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(undefined);

    try {
      const response = await listNotifications(auth);
      const found = response.items.find((item) => item.id === notificationId);
      if (!found) {
        setNotification(null);
        setError("Không tìm thấy thông báo trong phiên hiện tại.");
        return;
      }

      if (!found.read) {
        setNotification(await markNotificationRead(found.id, auth));
      } else {
        setNotification(found);
      }
    } catch (requestError: unknown) {
      setNotification(null);
      setError(getErrorMessage(requestError));
    } finally {
      setIsLoading(false);
    }
  }, [accessToken, auth, notificationId]);

  useEffect(() => {
    void Promise.resolve().then(() => loadNotification());
  }, [loadNotification]);

  const targetRoute = notification ? getNotificationRoute(notification) : null;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => router.back()}
          style={styles.backButton}
          testID="notification-detail-back"
        >
          <Text style={styles.backLabel}>‹ Quay lại</Text>
        </Pressable>

        <View style={styles.header}>
          <Text style={styles.eyebrow}>M8 · NOTIFICATION</Text>
          <Text style={styles.title}>Chi tiết thông báo</Text>
          <Text style={styles.description}>
            Nội dung do server ghi nhận; nút bên dưới chỉ điều hướng tới module đích, không tự xác nhận giao dịch.
          </Text>
        </View>

        {isLoading ? (
          <View style={styles.centerState}>
            <ActivityIndicator color={colors.primary} size="large" />
          </View>
        ) : error ? (
          <View style={styles.card}>
            <Text style={styles.errorText}>{error}</Text>
            <PrimaryButton
              label="Thử lại"
              onPress={() => void loadNotification()}
              testID="notification-detail-retry"
            />
          </View>
        ) : notification ? (
          <View style={styles.card} testID="notification-detail">
            <Text style={styles.typeLabel}>{notification.type}</Text>
            <Text style={styles.notificationTitle}>{notification.title}</Text>
            <Text style={styles.notificationBody}>{notification.body}</Text>
            <Text style={styles.notificationDate}>{formatDate(notification.createdAt)}</Text>
            <Text style={styles.readState}>Đã đọc</Text>
            {targetRoute ? (
              <PrimaryButton
                label="Mở nội dung liên quan"
                onPress={() => router.push(targetRoute)}
                testID="notification-open-target"
              />
            ) : null}
          </View>
        ) : null}
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
    minHeight: 180,
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing.md,
    backgroundColor: colors.surface,
  },
  typeLabel: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
  },
  notificationTitle: {
    color: colors.text,
    fontSize: 21,
    fontWeight: "700",
  },
  notificationBody: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 24,
  },
  notificationDate: {
    color: colors.muted,
    fontSize: 13,
  },
  readState: {
    color: colors.success,
    fontSize: 13,
    fontWeight: "700",
  },
  errorText: {
    color: colors.danger,
    fontSize: 14,
    lineHeight: 20,
  },
});
