import { Pressable, StyleSheet, Text, View } from "react-native";

import type { PaymentAccount } from "@/features/accounts/types/account";
import {
  getAccountNumberDisplay,
  getAccountStatusLabel,
} from "@/features/accounts/presentation/accountPresentation";
import { getBalanceDisplay } from "@/features/home/presentation/homePresentation";
import { colors, spacing } from "@/theme";

type BalanceCardProps = {
  account: PaymentAccount;
  isBalanceVisible: boolean;
  isAccountNumberVisible: boolean;
  isAccountNumberLoading: boolean;
  isCopyingAccountNumber: boolean;
  revealedAccountNumber: string | null;
  onPress: () => void;
  onToggleBalance: () => void;
  onToggleAccountNumber: () => void;
  onCopyAccountNumber: () => void;
};

export function BalanceCard({
  account,
  isBalanceVisible,
  isAccountNumberVisible,
  isAccountNumberLoading,
  isCopyingAccountNumber,
  revealedAccountNumber,
  onPress,
  onToggleBalance,
  onToggleAccountNumber,
  onCopyAccountNumber,
}: BalanceCardProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Mở chi tiết ${account.displayName}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
      testID="account-detail"
    >
      <View testID="home-balance-card">
        <View style={styles.headerRow}>
          <Text style={styles.cardTitle}>Tổng số dư VND</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isBalanceVisible ? "Ẩn số dư" : "Hiện số dư"}
            onPress={onToggleBalance}
            style={styles.eyeButton}
            testID="home-toggle-balance"
          >
            <Text style={styles.eyeIcon}>{isBalanceVisible ? "◉" : "◎"}</Text>
          </Pressable>
        </View>

        <Text style={styles.totalBalance}>
          {getBalanceDisplay(account.currentBalance.amountMinor, isBalanceVisible)}
        </Text>

        <View style={styles.accountLine}>
          <View style={styles.accountLineText}>
            <Text style={styles.accountName}>{account.displayName}</Text>
            <Text style={styles.maskedNumber} testID="home-account-number">
              {getAccountNumberDisplay(
                account.maskedNumber,
                revealedAccountNumber,
                isAccountNumberVisible,
              )}
            </Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </View>

        <View style={styles.accountActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              isAccountNumberVisible ? "Ẩn số tài khoản" : "Hiện đầy đủ số tài khoản"
            }
            disabled={isAccountNumberLoading}
            onPress={onToggleAccountNumber}
            style={[styles.accountAction, isAccountNumberLoading ? styles.disabledAction : null]}
            testID="home-toggle-account-number"
          >
            <Text style={styles.accountActionLabel}>
              {isAccountNumberLoading ? "Đang tải" : isAccountNumberVisible ? "Ẩn" : "Hiện đầy đủ"}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sao chép đầy đủ số tài khoản"
            disabled={isCopyingAccountNumber || isAccountNumberLoading}
            onPress={onCopyAccountNumber}
            style={[
              styles.accountAction,
              isCopyingAccountNumber || isAccountNumberLoading ? styles.disabledAction : null,
            ]}
            testID="home-copy-account-number"
          >
            <Text style={styles.accountActionLabel}>
              {isCopyingAccountNumber ? "Đang sao chép" : "Sao chép"}
            </Text>
          </Pressable>
        </View>

        <View style={styles.statusRow}>
          <View
            style={[
              styles.statusPill,
              account.status === "BLOCKED" ? styles.statusPillBlocked : null,
            ]}
          >
            <Text style={styles.statusText}>{getAccountStatusLabel(account.status)}</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.lg,
    borderRadius: 24,
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 6,
  },
  pressed: {
    opacity: 0.92,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  cardTitle: {
    color: colors.surface,
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  eyeButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.55)",
    borderRadius: 14,
  },
  eyeIcon: {
    color: colors.surface,
    fontSize: 19,
    fontWeight: "700",
  },
  totalBalance: {
    marginTop: spacing.sm,
    color: colors.surface,
    fontSize: 30,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  accountLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.28)",
  },
  accountLineText: {
    flex: 1,
    gap: spacing.xs,
  },
  accountActions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  accountAction: {
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.55)",
    borderRadius: 12,
  },
  disabledAction: {
    opacity: 0.55,
  },
  accountActionLabel: {
    color: colors.surface,
    fontSize: 12,
    fontWeight: "800",
  },
  accountName: {
    color: colors.surface,
    fontSize: 15,
    fontWeight: "700",
  },
  maskedNumber: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 14,
  },
  chevron: {
    color: colors.surface,
    fontSize: 28,
    fontWeight: "300",
  },
  statusRow: {
    alignItems: "flex-end",
    marginTop: spacing.lg,
  },
  statusPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  statusPillBlocked: {
    backgroundColor: "rgba(255,221,221,0.28)",
  },
  statusText: {
    color: colors.surface,
    fontSize: 10,
    fontWeight: "800",
  },
});
