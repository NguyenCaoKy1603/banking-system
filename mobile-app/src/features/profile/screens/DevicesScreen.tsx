import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";

import { AppHeader } from "@/components/ui/AppHeader";
import { AppIcon } from "@/components/ui/AppIcon";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Screen } from "@/components/ui/Screen";
import { StateCard } from "@/components/ui/StateCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAuth } from "@/features/auth/context/AuthContext";
import { listDevices, revokeDevice } from "@/features/auth/services/authApi";
import type { CustomerDevice } from "@/features/auth/types/auth";
import { ApiError } from "@/services/api/ApiError";
import { colors, radius, shadows, sizes, spacing, typography } from "@/theme";

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("vi-VN");
}

function maskDeviceId(deviceId: string): string {
  const trimmed = deviceId.trim();
  if (trimmed.length <= 10) return trimmed;
  return `${trimmed.slice(0, 6)}••••${trimmed.slice(-4)}`;
}

export function DevicesScreen() {
  const router = useRouter();
  const { deviceId, logout, refreshAccessToken, session } = useAuth();
  const [devices, setDevices] = useState<CustomerDevice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();

  const auth = useMemo(() => {
    if (!session || !deviceId) return null;
    return {
      accessToken: session.accessToken,
      deviceId,
      refreshAccessToken,
    };
  }, [deviceId, refreshAccessToken, session]);

  const loadDevices = useCallback(async () => {
    if (!auth) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(undefined);
    try {
      const response = await listDevices(auth);
      setDevices(response.items);
    } catch (loadError: unknown) {
      setError(
        loadError instanceof ApiError
          ? loadError.message
          : "Không thể tải danh sách thiết bị. Vui lòng thử lại.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [auth]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadDevices();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadDevices]);

  async function executeRevoke(target: CustomerDevice) {
    if (!auth) return;
    setRevokingId(target.id);
    setError(undefined);
    try {
      await revokeDevice(target.id, auth);
      if (target.isCurrentDevice) {
        await logout();
        return;
      }
      await loadDevices();
    } catch (revokeError: unknown) {
      setError(
        revokeError instanceof ApiError
          ? revokeError.message
          : "Không thể thu hồi thiết bị. Vui lòng thử lại.",
      );
    } finally {
      setRevokingId(null);
    }
  }

  function confirmRevoke(target: CustomerDevice) {
    Alert.alert(
      target.isCurrentDevice ? "Thu hồi thiết bị hiện tại?" : "Thu hồi thiết bị này?",
      target.isCurrentDevice
        ? "Phiên đăng nhập trên thiết bị này sẽ kết thúc ngay lập tức và bạn cần đăng nhập lại."
        : `Tất cả phiên đăng nhập trên ${target.deviceName} sẽ bị thu hồi ngay lập tức.`,
      [
        { text: "Hủy", style: "cancel" },
        {
          text: "Thu hồi thiết bị",
          style: "destructive",
          onPress: () => void executeRevoke(target),
        },
      ],
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <AppHeader
          backTestID="devices-back"
          eyebrow="BẢO MẬT PHIÊN"
          onBack={() => router.back()}
          subtitle="Theo dõi các thiết bị đã đăng nhập và thu hồi quyền truy cập từ xa bất cứ lúc nào."
          title="Thiết bị đăng nhập"
        />

        {isLoading ? (
          <StateCard loading message="Đang tải danh sách thiết bị..." />
        ) : error ? (
          <StateCard
            actionLabel="Thử lại"
            actionTestID="devices-retry"
            icon="alert"
            message={error}
            onAction={() => void loadDevices()}
            title="Không tải được thiết bị"
          />
        ) : devices.length === 0 ? (
          <StateCard
            icon="devices"
            message="Chưa ghi nhận thiết bị nào đang hoạt động."
            title="Không có thiết bị hoạt động"
          />
        ) : (
          <View style={styles.list}>
            {devices.map((item) => (
              <Card elevated key={item.id} style={styles.deviceCard} testID={`device-card-${item.id}`}>
                <View style={styles.deviceHeader}>
                  <View style={styles.deviceIconBox}>
                    <AppIcon color={colors.primary} name="devices" size={22} />
                  </View>
                  <View style={styles.deviceInfo}>
                    <View style={styles.deviceTitleRow}>
                      <Text style={styles.deviceName}>{item.deviceName}</Text>
                      {item.isCurrentDevice ? (
                        <StatusBadge label="Thiết bị hiện tại" tone="success" />
                      ) : null}
                    </View>
                    <Text style={styles.deviceMeta}>Mã thiết bị: {maskDeviceId(item.deviceId)}</Text>
                    <Text style={styles.deviceMeta}>
                      Hoạt động gần nhất: {formatDateTime(item.lastSeenAt)}
                    </Text>
                    <Text style={styles.deviceMeta}>
                      Phiên đang mở: {item.activeSessionCount}
                    </Text>
                  </View>
                </View>
                <Button
                  disabled={revokingId !== null}
                  label={revokingId === item.id ? "Đang thu hồi..." : "Thu hồi thiết bị"}
                  loading={revokingId === item.id}
                  onPress={() => confirmRevoke(item)}
                  testID={`revoke-device-${item.id}`}
                  variant="danger"
                />
              </Card>
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
  list: {
    gap: spacing.md,
  },
  deviceCard: {
    gap: spacing.md,
    ...shadows.card,
  },
  deviceHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  deviceIconBox: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  deviceInfo: {
    flex: 1,
    gap: spacing.xs,
  },
  deviceTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  deviceName: {
    ...typography.subheading,
    color: colors.text,
  },
  deviceMeta: {
    ...typography.caption,
    color: colors.muted,
  },
});
