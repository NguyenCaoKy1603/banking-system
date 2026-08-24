import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { AuthProvider, useAuth } from "@/features/auth/context/AuthContext";
import { colors, spacing } from "@/theme";

function RootNavigator() {
  const { isAuthenticated, logout, refreshAccessToken, status } = useAuth();
  const [recoveryError, setRecoveryError] = useState<string | null>(null);

  if (
    status === "booting" ||
    status === "refreshing" ||
    status === "loggingOut"
  ) {
    return (
      <View style={styles.loadingScreen}>
        <StatusBar style="dark" />
        <ActivityIndicator color={colors.primary} size="large" />
        {status === "loggingOut" ? (
          <Text accessibilityLiveRegion="polite" style={styles.loadingLabel}>
            Đang đăng xuất an toàn...
          </Text>
        ) : null}
      </View>
    );
  }

  if (status === "locked") {
    return (
      <View style={styles.lockedScreen}>
        <StatusBar style="dark" />
        <Text style={styles.lockedTitle}>Ứng dụng đang khóa</Text>
        <Text style={styles.lockedDescription}>
          Cần xác nhận lại phiên với máy chủ trước khi hiển thị dữ liệu tài chính.
        </Text>
        {recoveryError ? (
          <Text accessibilityLiveRegion="polite" style={styles.lockedError}>
            {recoveryError}
          </Text>
        ) : null}
        <View style={styles.lockedActions}>
          <PrimaryButton
            label="Thử xác nhận lại"
            onPress={() => {
              setRecoveryError(null);
              void refreshAccessToken().catch(() => {
                setRecoveryError(
                  "Chưa thể kết nối để xác nhận phiên. Dữ liệu vẫn được khóa an toàn.",
                );
              });
            }}
            testID="session-recovery-retry"
          />
          <PrimaryButton
            label="Đăng xuất thiết bị này"
            onPress={() => void logout()}
            testID="session-recovery-logout"
          />
        </View>
      </View>
    );
  }

  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: colors.background },
          headerShown: false,
        }}
      >
        <Stack.Protected guard={!isAuthenticated}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={isAuthenticated}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="account/[accountId]" />
          <Stack.Screen name="history" />
          <Stack.Screen name="transfer" />
          <Stack.Screen name="beneficiaries" />
          <Stack.Screen name="cards" />
          <Stack.Screen name="cards/apply" />
          <Stack.Screen name="cards/[cardId]" />
          <Stack.Screen name="transaction/[transactionId]" />
          <Stack.Screen name="notifications" />
          <Stack.Screen name="notifications/[notificationId]" />
          <Stack.Screen name="fraud-report" />
          <Stack.Screen name="kyc" />
          <Stack.Screen name="qr" />
          <Stack.Screen name="savings" />
          <Stack.Screen name="savings/open" />
          <Stack.Screen name="savings/[depositId]" />
        </Stack.Protected>
      </Stack>
    </>
  );
}

const styles = StyleSheet.create({
  loadingScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.background,
  },
  loadingLabel: {
    color: colors.muted,
    fontSize: 14,
  },
  lockedScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.md,
    backgroundColor: colors.background,
  },
  lockedTitle: {
    color: colors.text,
    fontSize: 26,
    fontWeight: "700",
    textAlign: "center",
  },
  lockedDescription: {
    maxWidth: 520,
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  lockedError: {
    maxWidth: 520,
    color: colors.danger,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  lockedActions: {
    width: "100%",
    maxWidth: 360,
    gap: spacing.sm,
  },
});

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootNavigator />
    </AuthProvider>
  );
}
