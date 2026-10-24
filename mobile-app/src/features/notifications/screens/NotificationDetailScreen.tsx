import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { AppHeader } from "@/components/ui/AppHeader";
import { AppIcon, type AppIconName } from "@/components/ui/AppIcon";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Screen } from "@/components/ui/Screen";
import { StateCard } from "@/components/ui/StateCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAuth } from "@/features/auth/context/AuthContext";
import { getNotificationRoute } from "@/features/notifications/navigation/notificationRoute";
import {
  listNotifications,
  markNotificationRead,
} from "@/features/notifications/services/notificationsApi";
import type {
  Notification,
  NotificationType,
} from "@/features/notifications/types/notification";
import { ApiError } from "@/services/api/ApiError";
import { colors, radius, sizes, spacing, typography } from "@/theme";

function getErrorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "Không thể tải chi tiết thông báo. Vui lòng thử lại.";
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("vi-VN");
}

function getTypePresentation(type: NotificationType): {
  label: string;
  icon: AppIconName;
} {
  if (type === "TRANSFER") return { label: "Chuyển tiền", icon: "transfer" };
  if (type === "SAVINGS") return { label: "Tiền gửi", icon: "savings" };
  if (type === "CREDIT") return { label: "Thẻ tín dụng", icon: "card" };
  return { label: "Bảo mật", icon: "shield" };
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
      setNotification(found.read ? found : await markNotificationRead(found.id, auth));
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
  const presentation = notification ? getTypePresentation(notification.type) : null;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <AppHeader
          backTestID="notification-detail-back"
          eyebrow="Trung tâm cập nhật"
          onBack={() => router.back()}
          subtitle="Xem nội dung và mở nhanh chức năng liên quan."
          title="Chi tiết thông báo"
        />

        {isLoading ? (
          <StateCard loading message="Đang tải thông báo..." />
        ) : error ? (
          <StateCard
            actionLabel="Thử lại"
            actionTestID="notification-detail-retry"
            icon="alert"
            message={error}
            onAction={() => void loadNotification()}
            testID="notification-detail-error"
            title="Không thể tải thông báo"
          />
        ) : notification && presentation ? (
          <Card elevated style={styles.card} testID="notification-detail">
            <View style={styles.iconBox}>
              <AppIcon color={colors.primary} name={presentation.icon} size={27} />
            </View>
            <View style={styles.badges}>
              <StatusBadge label={presentation.label} tone="info" />
              <StatusBadge label="Đã đọc" tone="success" />
            </View>
            <Text style={styles.notificationTitle}>{notification.title}</Text>
            <Text style={styles.notificationBody}>{notification.body}</Text>
            <View style={styles.dateRow}>
              <AppIcon color={colors.subtle} name="history" size={16} />
              <Text style={styles.notificationDate}>{formatDate(notification.createdAt)}</Text>
            </View>
            {targetRoute ? (
              <Button
                icon="chevronRight"
                label="Mở nội dung liên quan"
                onPress={() => router.push(targetRoute)}
                testID="notification-open-target"
              />
            ) : null}
          </Card>
        ) : (
          <StateCard icon="bell" message="Thông báo không còn khả dụng." title="Không có dữ liệu" />
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
  card: { alignItems: "flex-start" },
  iconBox: {
    width: 58,
    height: 58,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.lg,
    backgroundColor: colors.primarySoft,
  },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  notificationTitle: { ...typography.heading, color: colors.text },
  notificationBody: { ...typography.body, color: colors.text },
  dateRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  notificationDate: { ...typography.caption, color: colors.muted },
});
