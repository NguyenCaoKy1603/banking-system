import { useCallback, useMemo, useState } from "react";
import * as Clipboard from "expo-clipboard";
import { useFocusEffect, useRouter } from "expo-router";
import { Alert, RefreshControl, ScrollView, StyleSheet, View } from "react-native";

import { Card } from "@/components/ui/Card";
import { ListRow } from "@/components/ui/ListRow";
import { RequestErrorNotice } from "@/components/ui/RequestErrorNotice";
import { Screen } from "@/components/ui/Screen";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StateCard } from "@/components/ui/StateCard";
import { getAccountNumber, listAccounts } from "@/features/accounts/services/accountsApi";
import type { PaymentAccount } from "@/features/accounts/types/account";
import { TotpRequiredNotice } from "@/features/auth/components/TotpRequiredNotice";
import { useAuth } from "@/features/auth/context/AuthContext";
import { listMfaMethods } from "@/features/auth/services/authApi";
import { BalanceCard } from "@/features/home/components/BalanceCard";
import { HomeHeader } from "@/features/home/components/HomeHeader";
import { QuickActionTile } from "@/features/home/components/QuickActionTile";
import { ApiError } from "@/services/api/ApiError";
import { colors, radius, sizes, spacing } from "@/theme";

export function HomeScreen() {
  const router = useRouter();
  const { deviceId, refreshAccessToken, session } = useAuth();
  const accessToken = session?.accessToken ?? null;
  const auth = useMemo(
    () => ({ accessToken, deviceId, refreshAccessToken }),
    [accessToken, deviceId, refreshAccessToken],
  );
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<unknown>();
  const [isSessionExpired, setIsSessionExpired] = useState(false);
  const [isBalanceVisible, setIsBalanceVisible] = useState(false);
  const [isAccountNumberVisible, setIsAccountNumberVisible] = useState(false);
  const [revealedAccountNumber, setRevealedAccountNumber] = useState<string | null>(null);
  const [isAccountNumberLoading, setIsAccountNumberLoading] = useState(false);
  const [isCopyingAccountNumber, setIsCopyingAccountNumber] = useState(false);
  const [accountNumberError, setAccountNumberError] = useState<unknown>();
  const [hasActiveTotp, setHasActiveTotp] = useState<boolean | null>(null);

  const account = useMemo(
    () => accounts.find((item) => item.id === selectedAccountId) ?? accounts[0] ?? null,
    [accounts, selectedAccountId],
  );

  const totalBalanceMinor = useMemo(
    () => accounts.reduce((sum, item) => sum + BigInt(item.currentBalance.amountMinor), 0n).toString(),
    [accounts],
  );

  const handleSelectAccount = useCallback((nextAccountId: string) => {
    setSelectedAccountId(nextAccountId);
    setIsAccountNumberVisible(false);
    setRevealedAccountNumber(null);
    setAccountNumberError(undefined);
  }, []);

  const checkMfaStatus = useCallback(async () => {
    if (!accessToken || !deviceId) {
      setHasActiveTotp(null);
      return;
    }
    try {
      const response = await listMfaMethods({
        accessToken,
        deviceId,
        refreshAccessToken,
      });
      const hasActive = response.items.some(
        (m) => m.status === "ACTIVE" && m.credentialType === "TOTP",
      );
      setHasActiveTotp(hasActive);
    } catch {
      // Non-blocking fail-safe: retain current state on error
    }
  }, [accessToken, deviceId, refreshAccessToken]);

  const loadAccounts = useCallback(async (resetVisualState = true) => {
    if (resetVisualState) {
      setIsBalanceVisible(false);
      setIsAccountNumberVisible(false);
      setRevealedAccountNumber(null);
    }
    setAccountNumberError(undefined);

    if (!accessToken) {
      setAccounts([]);
      setSelectedAccountId(null);
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
      setAccounts(response.accounts);
      setSelectedAccountId((current) =>
        current && response.accounts.some((item) => item.id === current)
          ? current
          : (response.accounts[0]?.id ?? null),
      );
    } catch (requestError: unknown) {
      setAccounts([]);
      setSelectedAccountId(null);
      setIsSessionExpired(requestError instanceof ApiError && requestError.status === 401);
      setError(requestError);
    } finally {
      setIsLoading(false);
    }
  }, [accessToken, auth]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await Promise.allSettled([loadAccounts(false), checkMfaStatus()]);
    } finally {
      setIsRefreshing(false);
    }
  }, [checkMfaStatus, loadAccounts]);

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
      void checkMfaStatus();
    }, [checkMfaStatus, loadAccounts]),
  );

  const fullName = session?.user.fullName?.trim() || "bạn";

  return (
    <Screen style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => void handleRefresh()}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        <HomeHeader
          fullName={fullName}
          onMenu={() => router.push("/profile")}
          onNotifications={() => router.push("/notifications")}
        />

        <View style={styles.section}>
          <SectionHeader title="Tài khoản thanh toán" />
          {isLoading ? (
            <StateCard loading message="Đang tải số dư an toàn..." testID="home-account-loading" />
          ) : isSessionExpired ? (
            <StateCard
              actionLabel="Đăng nhập lại"
              icon="lock"
              message="Vui lòng đăng nhập lại để tiếp tục xem dữ liệu tài khoản."
              onAction={() => router.replace("/login")}
              testID="home-session-expired"
              title="Phiên đăng nhập đã hết hạn"
            />
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
              accounts={accounts}
              totalBalanceMinor={totalBalanceMinor}
              isBalanceVisible={isBalanceVisible}
              isAccountNumberVisible={isAccountNumberVisible}
              isAccountNumberLoading={isAccountNumberLoading}
              isCopyingAccountNumber={isCopyingAccountNumber}
              revealedAccountNumber={revealedAccountNumber}
              accountNumberError={accountNumberError}
              onPress={() =>
                router.push({ pathname: "/account/[accountId]", params: { accountId: account.id } })
              }
              onSelectAccount={handleSelectAccount}
              onToggleBalance={() => setIsBalanceVisible((current) => !current)}
              onToggleAccountNumber={() => void handleToggleAccountNumber()}
              onCopyAccountNumber={() => void handleCopyAccountNumber()}
              onRetryAccountNumber={() => void revealAccountNumber()}
            />
          ) : (
            <StateCard
              icon="account"
              message="Tài khoản sẽ xuất hiện sau khi hồ sơ của bạn được hệ thống cấp."
              testID="home-account-empty"
              title="Chưa có tài khoản thanh toán"
            />
          )}
        </View>

        {hasActiveTotp === false ? (
          <TotpRequiredNotice
            title="Chưa kích hoạt mã bảo mật TOTP"
            message="Thiết lập Google Authenticator ngay để có thể Chuyển tiền, Gửi tiết kiệm và Quản lý thẻ an toàn."
            actionLabel="Kích hoạt TOTP ngay"
            testID="home-totp-banner"
          />
        ) : null}

        <View style={styles.section}>
          <SectionHeader title="Dịch vụ nhanh" />
          <View style={styles.quickActions}>
            <QuickActionTile
              icon="transfer"
              onPress={() => router.push("/transfer")}
              subtitle="Chuyển khoản"
              testID="quick-transfer"
              title="Chuyển tiền"
            />
            <QuickActionTile
              icon="savings"
              onPress={() => router.push("/savings")}
              subtitle="Quản lý kỳ hạn"
              testID="quick-deposit"
              title="Tiền gửi"
            />
            <QuickActionTile
              icon="card"
              onPress={() => router.push("/cards")}
              subtitle="Hạn mức và sao kê"
              testID="quick-cards"
              title="Thẻ tín dụng"
            />
          </View>
        </View>

        <View style={styles.section}>
          <SectionHeader title="Quản lý" />
          <Card style={styles.toolsCard}>
            <ListRow
              icon="history"
              onPress={() => router.push("/history")}
              subtitle="Tra cứu trạng thái và biên nhận"
              title="Lịch sử giao dịch"
            />
            <ListRow
              icon="users"
              onPress={() => router.push("/beneficiaries")}
              subtitle="Thêm và quản lý người nhận"
              title="Danh bạ người nhận"
            />
            <ListRow
              icon="account"
              onPress={() => router.push("/assistant")}
              subtitle="Hỏi đáp về cách sử dụng ứng dụng"
              testID="home-assistant-entry"
              title="Trợ lý hướng dẫn NOVA"
            />
          </Card>
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
    maxWidth: sizes.contentMaxWidth,
    alignSelf: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.xl,
  },
  section: {
    gap: spacing.sm,
  },
  quickActions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  toolsCard: {
    overflow: "hidden",
    gap: 0,
    padding: 0,
    borderRadius: radius.lg,
  },
});
