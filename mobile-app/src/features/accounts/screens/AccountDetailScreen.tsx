import { useCallback, useEffect, useMemo, useState } from "react";
import * as Clipboard from "expo-clipboard";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  Alert,
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { RequestErrorNotice } from "@/components/ui/RequestErrorNotice";
import { Screen } from "@/components/ui/Screen";
import { useAuth } from "@/features/auth/context/AuthContext";
import { getAccountNumber, listAccounts } from "@/features/accounts/services/accountsApi";
import {
  getAccountNumberDisplay,
  getAccountStatusLabel,
} from "@/features/accounts/presentation/accountPresentation";
import type { PaymentAccount } from "@/features/accounts/types/account";
import { formatVndMinor } from "@/features/banking/presentation/formatMoney";
import { colors, spacing } from "@/theme";

export function AccountDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ accountId?: string }>();
  const { deviceId, refreshAccessToken, session } = useAuth();
  const accessToken = session?.accessToken ?? null;
  const accountId = typeof params.accountId === "string" ? params.accountId : "";
  const auth = useMemo(
    () => ({ accessToken, deviceId, refreshAccessToken }),
    [accessToken, deviceId, refreshAccessToken],
  );
  const [account, setAccount] = useState<PaymentAccount | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [isNumberVisible, setIsNumberVisible] = useState(false);
  const [revealedAccountNumber, setRevealedAccountNumber] = useState<string | null>(null);
  const [isRevealingNumber, setIsRevealingNumber] = useState(false);
  const [isCopyingNumber, setIsCopyingNumber] = useState(false);
  const [accountNumberError, setAccountNumberError] = useState<unknown>();

  const loadAccount = useCallback(async () => {
    if (!accessToken || !accountId) {
      setIsLoading(false);
      setAccount(null);
      return;
    }

    setIsLoading(true);
    setError(undefined);
    setIsNumberVisible(false);
    setRevealedAccountNumber(null);
    setAccountNumberError(undefined);

    try {
      const response = await listAccounts(auth);
      setAccount(response.accounts.find((item) => item.id === accountId) ?? null);
    } catch (requestError: unknown) {
      setAccount(null);
      setError(requestError);
    } finally {
      setIsLoading(false);
    }
  }, [accountId, accessToken, auth]);

  useEffect(() => {
    void Promise.resolve().then(() => loadAccount());
  }, [loadAccount]);

  const revealAccountNumber = useCallback(async (): Promise<string | null> => {
    if (!account) {
      return null;
    }

    if (revealedAccountNumber) {
      return revealedAccountNumber;
    }

    setIsRevealingNumber(true);
    setAccountNumberError(undefined);
    try {
      const response = await getAccountNumber(account.id, auth);
      setRevealedAccountNumber(response.accountNumber);
      return response.accountNumber;
    } catch (requestError: unknown) {
      setAccountNumberError(requestError);
      return null;
    } finally {
      setIsRevealingNumber(false);
    }
  }, [account, auth, revealedAccountNumber]);

  const handleToggleNumber = useCallback(async () => {
    if (isRevealingNumber) {
      return;
    }

    if (isNumberVisible) {
      setIsNumberVisible(false);
      return;
    }

    const fullAccountNumber = await revealAccountNumber();
    if (fullAccountNumber) {
      setIsNumberVisible(true);
    }
  }, [isNumberVisible, isRevealingNumber, revealAccountNumber]);

  const handleCopyNumber = useCallback(async () => {
    if (!account || isCopyingNumber || isRevealingNumber) {
      return;
    }

    setIsCopyingNumber(true);
    try {
      const fullAccountNumber = await revealAccountNumber();
      if (!fullAccountNumber) {
        return;
      }

      await Clipboard.setStringAsync(fullAccountNumber);
      setIsNumberVisible(true);
      Alert.alert("Đã sao chép", "Số tài khoản đầy đủ đã được sao chép.");
    } catch {
      Alert.alert("Không thể sao chép", "Vui lòng thử lại.");
    } finally {
      setIsCopyingNumber(false);
    }
  }, [account, isCopyingNumber, isRevealingNumber, revealAccountNumber]);

  const ownerName = session?.user.fullName ?? "Chủ tài khoản";

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => router.back()}
          style={styles.backButton}
          testID="account-detail-back"
        >
          <Text style={styles.backLabel}>‹ Quay lại</Text>
        </Pressable>

        <View style={styles.header}>
          <Text style={styles.eyebrow}>M3 · ACCOUNT</Text>
          <Text style={styles.title}>Chi tiết tài khoản</Text>
          <Text style={styles.description}>
            Số dư và trạng thái được tải lại từ Backend; Mobile không tự quyết định giá trị.
          </Text>
        </View>

        {isLoading ? (
          <View style={styles.centerState}>
            <ActivityIndicator color={colors.primary} size="large" />
          </View>
        ) : error ? (
          <RequestErrorNotice
            error={error}
            fallbackMessage="Không thể tải chi tiết tài khoản. Vui lòng thử lại."
            onRetry={loadAccount}
            testID="account-detail-error"
          />
        ) : !account ? (
          <View style={styles.card}>
            <Text style={styles.emptyText}>Không tìm thấy tài khoản trong phạm vi phiên hiện tại.</Text>
          </View>
        ) : (
          <>
            <View style={styles.card} testID="account-detail-card">
              <View style={styles.accountHeader}>
                <View style={styles.headerText}>
                  <Text style={styles.accountName}>{account.displayName}</Text>
                </View>
                <Text style={[styles.status, account.status === "BLOCKED" ? styles.statusBlocked : null]}>
                  {getAccountStatusLabel(account.status)}
                </Text>
              </View>
              <View style={styles.numberSection}>
                <Text style={styles.label}>Số tài khoản đã che</Text>
                <View style={styles.numberRow}>
                  <Text style={styles.maskedNumber} testID="account-detail-number">
                    {getAccountNumberDisplay(
                      account.maskedNumber,
                      revealedAccountNumber,
                      isNumberVisible,
                    )}
                  </Text>
                  <View style={styles.numberActions}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={isNumberVisible ? "Ẩn số tài khoản" : "Hiện số tài khoản"}
                      disabled={isRevealingNumber}
                      onPress={() => void handleToggleNumber()}
                      style={[styles.numberAction, isRevealingNumber ? styles.numberActionDisabled : null]}
                      testID="account-detail-toggle-number"
                    >
                      <Text style={styles.numberActionLabel}>
                        {isRevealingNumber ? "Đang tải" : isNumberVisible ? "Ẩn" : "Hiện"}
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Sao chép số tài khoản đầy đủ"
                      disabled={isCopyingNumber || isRevealingNumber}
                      onPress={() => void handleCopyNumber()}
                      style={[styles.numberAction, isCopyingNumber || isRevealingNumber ? styles.numberActionDisabled : null]}
                      testID="account-detail-copy-number"
                    >
                      <Text style={styles.numberActionLabel}>
                        {isCopyingNumber ? "Đang sao chép" : "Sao chép"}
                      </Text>
                    </Pressable>
                  </View>
                </View>
                <Text style={styles.securityNote}>
                  Số đầy đủ chỉ được tải từ server khi bạn bấm Hiện hoặc Sao chép.
                </Text>
                {accountNumberError ? (
                  <RequestErrorNotice
                    error={accountNumberError}
                    fallbackMessage="Không thể tải số tài khoản đầy đủ. Vui lòng thử lại."
                    onRetry={() => void revealAccountNumber()}
                    testID="account-detail-number-error"
                  />
                ) : null}
              </View>
              <View style={styles.balanceGrid}>
                <View style={styles.balanceCell}>
                  <Text style={styles.label}>Số dư khả dụng</Text>
                  <Text style={styles.value}>{formatVndMinor(account.availableBalance.amountMinor)}</Text>
                </View>
                <View style={styles.balanceCell}>
                  <Text style={styles.label}>Số dư hiện tại</Text>
                  <Text style={styles.value}>{formatVndMinor(account.currentBalance.amountMinor)}</Text>
                </View>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.label}>Tên chủ tài khoản</Text>
                <Text style={styles.detailValue}>{ownerName}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.label}>Ngân hàng</Text>
                <Text style={styles.detailValue}>{account.bankName}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.label}>Loại tiền</Text>
                <Text style={styles.detailValue}>{account.currency}</Text>
              </View>
            </View>
            <PrimaryButton
              label="Xem lịch sử giao dịch"
              onPress={() => router.push("/history")}
              testID="account-detail-history"
            />
            <PrimaryButton
              label="Chuyển tiền"
              onPress={() => router.push("/transfer")}
              testID="account-detail-transfer"
            />
            <PrimaryButton
              label="Nhận tiền / QR"
              onPress={() =>
                router.push({
                  pathname: "/qr",
                  params: { mode: "my", accountId: account.id },
                })
              }
              testID="account-detail-receive-qr"
            />
          </>
        )}
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
    gap: spacing.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing.md,
    backgroundColor: colors.surface,
  },
  accountHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  numberSection: {
    gap: spacing.sm,
  },
  numberRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  numberActions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  numberAction: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: spacing.sm,
  },
  numberActionDisabled: {
    opacity: 0.5,
  },
  numberActionLabel: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: "700",
  },
  headerText: {
    flex: 1,
    gap: spacing.xs,
  },
  accountName: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "700",
  },
  maskedNumber: {
    color: colors.muted,
    fontSize: 15,
  },
  status: {
    color: colors.success,
    fontSize: 12,
    fontWeight: "700",
  },
  statusBlocked: {
    color: colors.danger,
  },
  balanceGrid: {
    flexDirection: "row",
    gap: spacing.lg,
  },
  balanceCell: {
    flex: 1,
    gap: spacing.xs,
  },
  label: {
    color: colors.muted,
    fontSize: 13,
  },
  value: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "700",
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  detailValue: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    fontWeight: "600",
    textAlign: "right",
  },
  securityNote: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
  },
  emptyText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "600",
  },
});
