import { useCallback, useEffect, useMemo, useState } from "react";
import * as Clipboard from "expo-clipboard";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { AppHeader } from "@/components/ui/AppHeader";
import { AppIcon } from "@/components/ui/AppIcon";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { RequestErrorNotice } from "@/components/ui/RequestErrorNotice";
import { Screen } from "@/components/ui/Screen";
import { StateCard } from "@/components/ui/StateCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAuth } from "@/features/auth/context/AuthContext";
import { getAccountNumber, listAccounts } from "@/features/accounts/services/accountsApi";
import {
  getAccountNumberDisplay,
  getAccountStatusLabel,
} from "@/features/accounts/presentation/accountPresentation";
import type { PaymentAccount } from "@/features/accounts/types/account";
import { formatVndMinor } from "@/features/banking/presentation/formatMoney";
import { colors, radius, sizes, spacing, typography } from "@/theme";

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
        <AppHeader
          backTestID="account-detail-back"
          eyebrow="Tài khoản thanh toán"
          onBack={() => router.back()}
          subtitle="Theo dõi số dư và thông tin nhận tiền của bạn."
          title="Chi tiết tài khoản"
        />

        {isLoading ? (
          <StateCard loading message="Đang tải thông tin tài khoản..." />
        ) : error ? (
          <RequestErrorNotice
            error={error}
            fallbackMessage="Không thể tải chi tiết tài khoản. Vui lòng thử lại."
            onRetry={loadAccount}
            testID="account-detail-error"
          />
        ) : !account ? (
          <StateCard
            icon="account"
            message="Không tìm thấy tài khoản trong phiên đăng nhập hiện tại."
            title="Tài khoản không khả dụng"
          />
        ) : (
          <>
            <Card elevated style={styles.accountCard} testID="account-detail-card">
              <View style={styles.accountHeader}>
                <View style={styles.accountHeading}>
                  <Text style={styles.accountKicker}>TÀI KHOẢN CỦA TÔI</Text>
                  <Text style={styles.accountName}>{account.displayName}</Text>
                </View>
                <StatusBadge
                  label={getAccountStatusLabel(account.status)}
                  tone={account.status === "BLOCKED" ? "danger" : "success"}
                />
              </View>

              <View style={styles.numberSection}>
                <Text style={styles.label}>Số tài khoản</Text>
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
                      <AppIcon
                        color={colors.primary}
                        name={isNumberVisible ? "eyeOff" : "eye"}
                        size={17}
                      />
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
                      <AppIcon color={colors.primary} name="copy" size={17} />
                      <Text style={styles.numberActionLabel}>
                        {isCopyingNumber ? "Đang sao chép" : "Sao chép"}
                      </Text>
                    </Pressable>
                  </View>
                </View>
                <Text style={styles.securityNote}>Số đầy đủ chỉ hiển thị theo yêu cầu và không được lưu lâu dài trên màn hình.</Text>
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
                <View style={[styles.balanceCell, styles.availableBalance]}>
                  <Text style={styles.label}>Số dư khả dụng</Text>
                  <Text adjustsFontSizeToFit numberOfLines={1} style={styles.primaryValue}>{formatVndMinor(account.availableBalance.amountMinor)}</Text>
                </View>
                <View style={styles.balanceCell}>
                  <Text style={styles.label}>Số dư hiện tại</Text>
                  <Text adjustsFontSizeToFit numberOfLines={1} style={styles.value}>{formatVndMinor(account.currentBalance.amountMinor)}</Text>
                </View>
              </View>
            </Card>

            <Card style={styles.detailsCard}>
              <Text style={styles.sectionTitle}>Thông tin tài khoản</Text>
              <DetailRow label="Tên chủ tài khoản" value={ownerName} />
              <DetailRow label="Ngân hàng" value={account.bankName} />
              <DetailRow label="Loại tiền" value={account.currency} />
            </Card>

            <View style={styles.actions}>
              <Button
                icon="transfer"
                label="Chuyển tiền"
                onPress={() => router.push("/transfer")}
                testID="account-detail-transfer"
              />
              <Button
                icon="qr"
                label="Nhận tiền / QR"
                onPress={() =>
                  router.push({ pathname: "/qr", params: { mode: "my", accountId: account.id } })
                }
                testID="account-detail-receive-qr"
                variant="secondary"
              />
              <Button
                icon="history"
                label="Xem lịch sử giao dịch"
                onPress={() => router.push("/history")}
                testID="account-detail-history"
                variant="outline"
              />
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
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
  accountCard: {
    gap: spacing.lg,
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
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
  },
  numberActionDisabled: {
    opacity: 0.5,
  },
  numberActionLabel: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: "700",
  },
  accountHeading: {
    flex: 1,
    gap: spacing.xs,
  },
  accountKicker: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  accountName: {
    ...typography.heading,
    color: colors.text,
  },
  maskedNumber: {
    ...typography.bodyStrong,
    color: colors.text,
    letterSpacing: 0.6,
  },
  balanceGrid: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  balanceCell: {
    flex: 1,
    minHeight: 104,
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  availableBalance: {
    backgroundColor: colors.primarySoft,
  },
  label: {
    ...typography.caption,
    color: colors.muted,
  },
  value: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  primaryValue: {
    ...typography.subheading,
    color: colors.primary,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  detailValue: {
    flex: 1,
    ...typography.bodyStrong,
    color: colors.text,
    textAlign: "right",
  },
  securityNote: {
    ...typography.caption,
    color: colors.muted,
  },
  sectionTitle: {
    ...typography.subheading,
    color: colors.text,
  },
  detailsCard: {
    gap: spacing.sm,
  },
  actions: {
    gap: spacing.sm,
  },
});
