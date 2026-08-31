import { useState } from "react";
import { useRouter } from "expo-router";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EnvironmentBadge } from "@/components/ui/EnvironmentBadge";
import { ListRow } from "@/components/ui/ListRow";
import { Screen } from "@/components/ui/Screen";
import { useAuth } from "@/features/auth/context/AuthContext";
import { colors, radius, sizes, spacing, typography } from "@/theme";

export function ProfileScreen() {
  const router = useRouter();
  const { logout, logoutAll, session } = useAuth();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | undefined>();

  async function handleLogout() {
    setIsLoggingOut(true);
    setLogoutError(undefined);

    try {
      await logout();
    } catch {
      setLogoutError("Không thể xóa phiên trên thiết bị. Vui lòng thử lại.");
    } finally {
      setIsLoggingOut(false);
    }
  }

  async function handleLogoutAll() {
    setIsLoggingOut(true);
    setLogoutError(undefined);

    try {
      await logoutAll();
    } catch {
      setLogoutError("Không thể xóa các phiên trên thiết bị. Vui lòng thử lại.");
    } finally {
      setIsLoggingOut(false);
    }
  }

  function confirmLogoutAll() {
    Alert.alert(
      "Đăng xuất mọi thiết bị?",
      "Tất cả phiên đang hoạt động sẽ bị thu hồi. Nếu đang ngoại tuyến, ứng dụng sẽ báo rõ khi máy chủ chưa xác nhận.",
      [
        { text: "Hủy", style: "cancel" },
        {
          text: "Đăng xuất tất cả",
          style: "destructive",
          onPress: () => void handleLogoutAll(),
        },
      ],
    );
  }

  const fullName = session?.user.fullName ?? "Người dùng";
  const avatarLabel = fullName.trim().charAt(0).toLocaleUpperCase("vi") || "N";

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} style={styles.scroll}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>TÀI KHOẢN CỦA TÔI</Text>
          <Text style={styles.title}>Hồ sơ và cài đặt</Text>
        </View>

        <Card elevated style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarLabel}>{avatarLabel}</Text>
          </View>
          <View style={styles.profileCopy}>
            <Text style={styles.name}>{fullName}</Text>
            <Text style={styles.email}>{session?.user.email ?? ""}</Text>
            <EnvironmentBadge />
          </View>
        </Card>

        {logoutError ? (
          <Text accessibilityLiveRegion="polite" style={styles.error}>
            {logoutError}
          </Text>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Tài chính</Text>
          <Card style={styles.menuCard}>
            <ListRow icon="bell" onPress={() => router.push("/notifications")} subtitle="Cập nhật giao dịch và trạng thái" testID="profile-notifications" title="Thông báo giao dịch" />
            <ListRow icon="qr" onPress={() => router.push("/qr")} subtitle="Chia sẻ thông tin nhận tiền" testID="profile-qr" title="Mã QR nhận tiền" />
            <ListRow icon="users" onPress={() => router.push("/beneficiaries")} subtitle="Quản lý người nhận đã lưu" testID="profile-beneficiaries" title="Danh bạ người nhận" />
            <ListRow icon="card" onPress={() => router.push("/cards")} subtitle="Hạn mức, sao kê và thanh toán" testID="profile-cards" title="Thẻ của tôi" />
          </Card>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Danh tính và bảo mật</Text>
          <Card style={styles.menuCard}>
            <ListRow icon="profile" onPress={() => router.push("/kyc")} subtitle="Theo dõi trạng thái định danh" testID="profile-kyc" title="Hồ sơ định danh" />
            <ListRow icon="shield" onPress={() => router.push("/mfa")} subtitle="Authenticator và khôi phục MFA" testID="profile-mfa" title="Bảo mật tài khoản" />
          </Card>
        </View>

        <View style={styles.logoutActions}>
          <Button
            disabled={isLoggingOut}
            icon="logout"
            label={isLoggingOut ? "Đang đăng xuất..." : "Đăng xuất thiết bị này"}
            loading={isLoggingOut}
            onPress={handleLogout}
            testID="logout-current-device"
            variant="outline"
          />
          <Button
            disabled={isLoggingOut}
            icon="devices"
            label="Đăng xuất mọi thiết bị"
            onPress={confirmLogoutAll}
            testID="logout-all-devices"
            variant="danger"
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { width: "100%" },
  content: {
    width: "100%",
    maxWidth: sizes.contentMaxWidth,
    padding: spacing.lg,
    gap: spacing.xl,
    alignSelf: "center",
  },
  header: {
    gap: spacing.xs,
  },
  eyebrow: {
    ...typography.label,
    color: colors.primary,
    letterSpacing: 0.9,
  },
  title: {
    ...typography.title,
    color: colors.text,
  },
  profileCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  avatar: {
    width: 64,
    height: 64,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.navy,
  },
  avatarLabel: {
    ...typography.title,
    color: colors.onPrimary,
  },
  profileCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  name: {
    ...typography.heading,
    color: colors.text,
  },
  email: {
    ...typography.body,
    color: colors.muted,
  },
  section: {
    gap: spacing.smd,
  },
  sectionTitle: {
    ...typography.subheading,
    color: colors.text,
  },
  menuCard: {
    overflow: "hidden",
    gap: 0,
    padding: 0,
    borderRadius: radius.lg,
  },
  logoutActions: {
    gap: spacing.sm,
  },
  error: {
    ...typography.body,
    color: colors.danger,
  },
});
