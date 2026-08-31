import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { BrandMark } from "@/components/brand/BrandMark";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { AuthProvider, useAuth } from "@/features/auth/context/AuthContext";
import { colors, radius, spacing, typography } from "@/theme";

SplashScreen.setOptions({ duration: 300, fade: true });

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
        <BrandMark />
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
        <Card elevated style={styles.lockedCard}>
          <View style={styles.lockedMark}><BrandMark compact /></View>
          <Text style={styles.lockedTitle}>Dữ liệu đang được bảo vệ</Text>
          <Text style={styles.lockedDescription}>NOVA cần xác nhận lại phiên trước khi hiển thị thông tin tài chính.</Text>
          {recoveryError ? <Text accessibilityLiveRegion="polite" style={styles.lockedError}>{recoveryError}</Text> : null}
          <View style={styles.lockedActions}>
            <Button
              icon="shield"
              label="Thử xác nhận lại"
              onPress={() => {
                setRecoveryError(null);
                void refreshAccessToken().catch(() => {
                  setRecoveryError("Chưa thể kết nối để xác nhận phiên. Dữ liệu vẫn được khóa an toàn.");
                });
              }}
              testID="session-recovery-retry"
            />
            <Button icon="logout" label="Đăng xuất thiết bị này" onPress={() => void logout()} testID="session-recovery-logout" variant="outline" />
          </View>
        </Card>
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
          <Stack.Screen name="mfa" />
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
    gap: spacing.lg,
    backgroundColor: colors.background,
  },
  loadingLabel: {
    ...typography.body,
    color: colors.muted,
  },
  lockedScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
    backgroundColor: colors.background,
  },
  lockedCard: {
    width: "100%",
    maxWidth: 420,
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.xl,
  },
  lockedMark: {
    marginBottom: spacing.sm,
  },
  lockedTitle: {
    ...typography.title,
    color: colors.text,
    textAlign: "center",
  },
  lockedDescription: {
    maxWidth: 520,
    ...typography.body,
    color: colors.muted,
    textAlign: "center",
  },
  lockedError: {
    maxWidth: 520,
    ...typography.body,
    padding: spacing.smd,
    borderRadius: radius.sm,
    color: colors.danger,
    backgroundColor: colors.dangerSoft,
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
