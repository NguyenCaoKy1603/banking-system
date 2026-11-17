import {
  type Href,
  Stack,
  useGlobalSearchParams,
  usePathname,
  useRouter,
  useSegments,
} from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { BrandMark } from "@/components/brand/BrandMark";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { AuthProvider, useAuth } from "@/features/auth/context/AuthContext";
import {
  buildCurrentAuthenticatedHref,
  shouldUseReplaceForRestore,
} from "@/features/auth/domain/routePreservation";
import { colors, radius, spacing, typography } from "@/theme";

SplashScreen.setOptions({ duration: 300, fade: true });

function RootNavigator() {
  const { isAuthenticated, logout, refreshAccessToken, status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const segments = useSegments();
  const globalSearchParams = useGlobalSearchParams();
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [appState, setAppState] = useState<AppStateStatus>(
    AppState.currentState ?? "active",
  );
  const lastAuthenticatedHrefRef = useRef<string | null>(null);
  const needsRouteRestoreRef = useRef(false);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", setAppState);
    return () => subscription?.remove();
  }, []);

  useEffect(() => {
    if (status === "anonymous" || status === "loggingOut") {
      lastAuthenticatedHrefRef.current = null;
      needsRouteRestoreRef.current = false;
      return;
    }

    if (status === "locked" || status === "refreshing") {
      if (
        lastAuthenticatedHrefRef.current &&
        lastAuthenticatedHrefRef.current !== "/"
      ) {
        needsRouteRestoreRef.current = true;
      }
      return;
    }

    if (status !== "authenticated") {
      return;
    }

    if (needsRouteRestoreRef.current) {
      const targetHref = lastAuthenticatedHrefRef.current;
      const timer = setTimeout(() => {
        needsRouteRestoreRef.current = false;
        if (targetHref && targetHref !== "/") {
          if (shouldUseReplaceForRestore(targetHref)) {
            router.replace(targetHref as Href);
          } else {
            router.push(targetHref as Href);
          }
        }
      }, 0);
      return () => clearTimeout(timer);
    }

    const currentHref = buildCurrentAuthenticatedHref(
      pathname,
      segments,
      globalSearchParams,
    );
    if (currentHref !== null) {
      lastAuthenticatedHrefRef.current = currentHref;
    }
  }, [globalSearchParams, pathname, router, segments, status]);

  if (
    status === "booting" ||
    status === "refreshing"
  ) {
    return (
      <View style={styles.loadingScreen}>
        <StatusBar style="dark" />
        <BrandMark />
        <ActivityIndicator color={colors.primary} size="large" />
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
    <View style={styles.navigatorContainer}>
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
          <Stack.Screen name="cards/[cardId]/transactions" />
          <Stack.Screen name="cards/[cardId]/statements" />
          <Stack.Screen name="cards/[cardId]/statements/[statementId]" />
          <Stack.Screen name="cards/[cardId]/payments/[paymentId]" />
          <Stack.Screen name="cards/[cardId]/pay" />
          <Stack.Screen name="transaction/[transactionId]" />
          <Stack.Screen name="notifications" />
          <Stack.Screen name="notifications/[notificationId]" />
          <Stack.Screen name="kyc" />
          <Stack.Screen name="qr" />
          <Stack.Screen name="mfa" />
          <Stack.Screen name="savings" />
          <Stack.Screen name="savings/open" />
          <Stack.Screen name="savings/[depositId]" />
          <Stack.Screen name="assistant" />
          <Stack.Screen name="financial-advice" />
        </Stack.Protected>
      </Stack>
      {isAuthenticated && (appState === "background" || appState === "inactive") ? (
        <View
          accessibilityViewIsModal
          pointerEvents="auto"
          style={styles.privacyOverlay}
          testID="background-privacy-shield"
        >
          <BrandMark />
          <Text style={styles.lockedTitle}>Dữ liệu đang được bảo vệ</Text>
          <Text style={styles.privacySubtitle}>
            Nội dung tài chính được che tạm thời khi chuyển ứng dụng.
          </Text>
        </View>
      ) : null}
      {status === "loggingOut" ? (
        <View
          accessibilityViewIsModal
          pointerEvents="auto"
          style={styles.logoutOverlay}
        >
          <BrandMark />
          <ActivityIndicator color={colors.primary} size="large" />
          <Text accessibilityLiveRegion="polite" style={styles.loadingLabel}>
            Đang đăng xuất an toàn...
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  navigatorContainer: {
    flex: 1,
  },
  logoutOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.lg,
    backgroundColor: colors.background,
  },
  privacyOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
    gap: spacing.md,
    backgroundColor: colors.background,
  },
  privacySubtitle: {
    maxWidth: 420,
    ...typography.body,
    color: colors.muted,
    textAlign: "center",
  },
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
