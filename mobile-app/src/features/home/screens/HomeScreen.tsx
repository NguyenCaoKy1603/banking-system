import { useCallback, useMemo, useState } from "react";
import * as Clipboard from "expo-clipboard";
import { useFocusEffect, useRouter } from "expo-router";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from "react-native";

import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { RequestErrorNotice } from "@/components/ui/RequestErrorNotice";
import { Screen } from "@/components/ui/Screen";
import { getAccountNumber, listAccounts } from "@/features/accounts/services/accountsApi";
import type { PaymentAccount } from "@/features/accounts/types/account";
import { useAuth } from "@/features/auth/context/AuthContext";
import { BalanceCard } from "@/features/home/components/BalanceCard";
import { HomeHeader } from "@/features/home/components/HomeHeader";
import { QuickActionTile } from "@/features/home/components/QuickActionTile";
import { ApiError } from "@/services/api/ApiError";
import { colors, spacing } from "@/theme";

export function HomeScreen() {
  const router = useRouter();
  const { deviceId, refreshAccessToken, session } = useAuth();
  const accessToken = session?.accessToken ?? null;
  const auth = useMemo(
    () => ({ accessToken, deviceId, refreshAccessToken }),
    [accessToken, deviceId, refreshAccessToken],
  );
  const [account, setAccount] = useState<PaymentAccount | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [isSessionExpired, setIsSessionExpired] = useState(false);
  const [isBalanceVisible, setIsBalanceVisible] = useState(false);
  const [isAccountNumberVisible, setIsAccountNumberVisible] = useState(false);
  const [revealedAccountNumber, setRevealedAccountNumber] = useState<string | null>(null);
  const [isAccountNumberLoading, setIsAccountNumberLoading] = useState(false);
  const [isCopyingAccountNumber, setIsCopyingAccountNumber] = useState(false);
  const [accountNumberError, setAccountNumberError] = useState<unknown>();

  const loadAccounts = useCallback(async () => {
    setIsBalanceVisible(false);
    setIsAccountNumberVisible(false);
    setRevealedAccountNumber(null);
    setAccountNumberError(undefined);

    if (!accessToken) {
      setAccount(null);
      setError(undefined);
      setIsSessionExpired(true);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(undefined);
    setIsSessionExpired(false);

    try {
      const response = await listAccounts(auth);
      setAccount(response.accounts[0] ?? null);
    } catch (requestError: unknown) {
      setAccount(null);
      setIsSessionExpired(requestError instanceof ApiError && requestError.status === 401);
      setError(requestError);
    } finally {
      setIsLoading(false);
    }
  }, [accessToken, auth]);

  const revealAccountNumber = useCallback(async (): Promise<string | null> => {
    if (!account) {
      return null;
    }

    if (revealedAccountNumber) {
      return revealedAccountNumber;
    }

    setIsAccountNumberLoading(true);
    setAccountNumberError(undefined);
    try {
      const response = await getAccountNumber(account.id, auth);
      setRevealedAccountNumber(response.accountNumber);
      return response.accountNumber;
    } catch (requestError: unknown) {
      setAccountNumberError(requestError);
      return null;
    } finally {
      setIsAccountNumberLoading(false);
    }
  }, [account, auth, revealedAccountNumber]);

  const handleToggleAccountNumber = useCallback(async () => {
    if (isAccountNumberLoading) {
      return;
    }
    if (isAccountNumberVisible) {
      setIsAccountNumberVisible(false);
      return;
    }
    const fullAccountNumber = await revealAccountNumber();
    if (fullAccountNumber) {
      setIsAccountNumberVisible(true);
    }
  }, [isAccountNumberLoading, isAccountNumberVisible, revealAccountNumber]);

  const handleCopyAccountNumber = useCallback(async () => {
    if (isCopyingAccountNumber || isAccountNumberLoading) {
      return;
    }
    setIsCopyingAccountNumber(true);
    try {
      const fullAccountNumber = await revealAccountNumber();
      if (!fullAccountNumber) {
        return;
      }
      await Clipboard.setStringAsync(fullAccountNumber);
      setIsAccountNumberVisible(true);
      Alert.alert("Đã sao chép", "Số tài khoản đầy đủ đã được sao chép.");
    } catch {
      Alert.alert("Không thể sao chép", "Vui lòng thử lại.");
    } finally {
      setIsCopyingAccountNumber(false);
    }
  }, [isAccountNumberLoading, isCopyingAccountNumber, revealAccountNumber]);

  useFocusEffect(
    useCallback(() => {
      void loadAccounts();
    }, [loadAccounts]),
  );

  const fullName = session?.user.fullName?.trim() || "bạn";

  return (
    <Screen style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <HomeHeader
          fullName={fullName}
          onMenu={() => router.push("/profile")}
          onNotifications={() => router.push("/notifications")}
        />

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Số dư tài khoản thanh toán</Text>
          {isLoading ? (
            <View style={styles.stateCard} testID="home-account-loading">
              <ActivityIndicator color={colors.primary} size="large" />
              <Text style={styles.stateText}>Đang tải số dư...</Text>
            </View>
          ) : isSessionExpired ? (
            <View style={styles.stateCard} testID="home-session-expired">
              <Text style={styles.stateTitle}>Phiên đăng nhập đã hết hạn</Text>
              <Text style={styles.stateText}>Vui lòng đăng nhập lại để xem tài khoản.</Text>
              <PrimaryButton
                label="Đăng nhập lại"
                onPress={() => router.replace("/login")}
                testID="home-login-again"
              />
            </View>
          ) : error ? (
            <RequestErrorNotice
              error={error}
              fallbackMessage="Không thể tải dữ liệu tài khoản. Vui lòng thử lại."
              onRetry={loadAccounts}
              testID="home-account-error"
            />
          ) : account ? (
            <BalanceCard
              account={account}
              isBalanceVisible={isBalanceVisible}
              isAccountNumberVisible={isAccountNumberVisible}
              isAccountNumberLoading={isAccountNumberLoading}
              isCopyingAccountNumber={isCopyingAccountNumber}
              revealedAccountNumber={revealedAccountNumber}
              accountNumberError={accountNumberError}
              onPress={() =>
                router.push({ pathname: "/account/[accountId]", params: { accountId: account.id } })
              }
              onToggleBalance={() => setIsBalanceVisible((current) => !current)}
              onToggleAccountNumber={() => void handleToggleAccountNumber()}
              onCopyAccountNumber={() => void handleCopyAccountNumber()}
              onRetryAccountNumber={() => void revealAccountNumber()}
            />
          ) : (
            <View style={styles.stateCard} testID="home-account-empty">
              <Text style={styles.stateTitle}>Chưa có tài khoản thanh toán</Text>
              <Text style={styles.stateText}>Tài khoản sẽ xuất hiện khi được cấp từ hệ thống.</Text>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeadingRow}>
            <Text style={styles.sectionTitle}>Dịch vụ nhanh</Text>
            <Text style={styles.sectionHint}>Sandbox đồ án</Text>
          </View>
          <View style={styles.quickActions}>
            <QuickActionTile
              icon="↗"
              onPress={() => router.push("/transfer")}
              subtitle="Thực hiện ngay"
              testID="quick-transfer"
              title="Chuyển tiền"
            />
            <QuickActionTile
              icon="◫"
              onPress={() => router.push("/savings")}
              subtitle="Dữ liệu sandbox"
              testID="quick-deposit"
              title="Tiền gửi"
            />
            <QuickActionTile
              icon="▣"
              onPress={() => router.push("/cards")}
              subtitle="Dữ liệu sandbox"
              testID="quick-cards"
              title="Thẻ tín dụng"
            />
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    alignItems: "center",
  },
  content: {
    flexGrow: 1,
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.xl,
  },
  section: {
    gap: spacing.sm,
  },
  sectionHeadingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
  },
  sectionHint: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
  },
  quickActions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  stateCard: {
    minHeight: 150,
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    backgroundColor: colors.surface,
  },
  stateTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "800",
  },
  stateText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
});
