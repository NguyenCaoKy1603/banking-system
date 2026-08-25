import { useState } from "react";
import { useRouter } from "expo-router";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";

import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { Screen } from "@/components/ui/Screen";
import { useAuth } from "@/features/auth/context/AuthContext";
import { colors, spacing } from "@/theme";

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

  return (
    <Screen style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>HỒ SƠ</Text>
          <Text style={styles.title}>Thông tin cá nhân</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.name}>{session?.user.fullName ?? "Người dùng"}</Text>
          <Text style={styles.email}>{session?.user.email ?? ""}</Text>
          <Text style={styles.description}>Phiên đăng nhập được lưu bảo mật trên thiết bị.</Text>
        </View>

        {logoutError ? (
          <Text accessibilityLiveRegion="polite" style={styles.error}>
            {logoutError}
          </Text>
        ) : null}

        <PrimaryButton
          label="Thông báo giao dịch"
          onPress={() => router.push("/notifications")}
          testID="profile-notifications"
        />

        <PrimaryButton
          label="Hồ sơ định danh eKYC mô phỏng"
          onPress={() => router.push("/kyc")}
          testID="profile-kyc"
        />

        <PrimaryButton
          label="Bảo mật MFA / Authenticator"
          onPress={() => router.push("/mfa")}
          testID="profile-mfa"
        />

        <PrimaryButton
          label="Mã QR nhận tiền"
          onPress={() => router.push("/qr")}
          testID="profile-qr"
        />

        <PrimaryButton
          label="Danh bạ người nhận"
          onPress={() => router.push("/beneficiaries")}
          testID="profile-beneficiaries"
        />

        <PrimaryButton
          label="Thẻ của tôi"
          onPress={() => router.push("/cards")}
          testID="profile-cards"
        />

        <PrimaryButton
          disabled={isLoggingOut}
          label={isLoggingOut ? "Đang đăng xuất..." : "Đăng xuất"}
          onPress={handleLogout}
          testID="logout-current-device"
        />

        <PrimaryButton
          disabled={isLoggingOut}
          label="Đăng xuất mọi thiết bị"
          onPress={confirmLogoutAll}
          testID="logout-all-devices"
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    alignItems: "center",
  },
  content: {
    width: "100%",
    maxWidth: 720,
    padding: spacing.lg,
    gap: spacing.xl,
    alignSelf: "center",
  },
  header: {
    gap: spacing.xs,
  },
  eyebrow: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.4,
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "700",
  },
  card: {
    minHeight: 180,
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing.md,
    backgroundColor: colors.surface,
  },
  name: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "700",
  },
  email: {
    color: colors.muted,
    fontSize: 15,
  },
  description: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  error: {
    color: colors.danger,
    fontSize: 14,
    lineHeight: 20,
  },
});
