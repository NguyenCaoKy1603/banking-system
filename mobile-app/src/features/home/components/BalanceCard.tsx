import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppIcon } from "@/components/ui/AppIcon";
import { RequestErrorNotice } from "@/components/ui/RequestErrorNotice";
import { getAccountNumberDisplay, getAccountStatusLabel } from "@/features/accounts/presentation/accountPresentation";
import type { PaymentAccount } from "@/features/accounts/types/account";
import { getBalanceDisplay } from "@/features/home/presentation/homePresentation";
import { colors, radius, shadows, spacing, typography } from "@/theme";

type BalanceCardProps = {
  account: PaymentAccount;
  isBalanceVisible: boolean;
  isAccountNumberVisible: boolean;
  isAccountNumberLoading: boolean;
  isCopyingAccountNumber: boolean;
  revealedAccountNumber: string | null;
  accountNumberError?: unknown;
  onPress: () => void;
  onToggleBalance: () => void;
  onToggleAccountNumber: () => void;
  onCopyAccountNumber: () => void;
  onRetryAccountNumber: () => void;
};

export function BalanceCard({
  account,
  isBalanceVisible,
  isAccountNumberVisible,
  isAccountNumberLoading,
  isCopyingAccountNumber,
  revealedAccountNumber,
  accountNumberError,
  onPress,
  onToggleBalance,
  onToggleAccountNumber,
  onCopyAccountNumber,
  onRetryAccountNumber,
}: BalanceCardProps) {
  const accountNumber = getAccountNumberDisplay(account.maskedNumber, revealedAccountNumber, isAccountNumberVisible);

  return (
    <>
      <View style={styles.card} testID="home-balance-card">
        <View pointerEvents="none" style={styles.decorativeOrbLarge} />
        <View pointerEvents="none" style={styles.decorativeOrbSmall} />

        <View style={styles.headerRow}>
          <View style={styles.titleBlock}>
            <Text style={styles.cardLabel}>TỔNG SỐ DƯ VND</Text>
            <Text style={styles.totalBalance}>{getBalanceDisplay(account.currentBalance.amountMinor, isBalanceVisible)}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isBalanceVisible ? "Ẩn số dư" : "Hiện số dư"}
            hitSlop={6}
            onPress={onToggleBalance}
            style={({ pressed }) => [styles.iconAction, pressed ? styles.pressed : null]}
            testID="home-toggle-balance"
          >
            <AppIcon color={colors.onPrimary} name={isBalanceVisible ? "eyeOff" : "eye"} size={21} />
          </Pressable>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Mở chi tiết ${account.displayName}`}
          onPress={onPress}
          style={({ pressed }) => [styles.accountLine, pressed ? styles.pressed : null]}
          testID="account-detail"
        >
          <View style={styles.accountCopy}>
            <Text style={styles.accountName}>{account.displayName}</Text>
            <Text numberOfLines={1} style={styles.accountNumber} testID="home-account-number">{accountNumber}</Text>
          </View>
          <AppIcon color={colors.onPrimary} name="chevronRight" size={20} />
        </Pressable>

        <View style={styles.accountActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isAccountNumberVisible ? "Ẩn số tài khoản" : "Hiện đầy đủ số tài khoản"}
            disabled={isAccountNumberLoading}
            onPress={onToggleAccountNumber}
            style={({ pressed }) => [styles.textAction, pressed ? styles.pressed : null, isAccountNumberLoading ? styles.disabled : null]}
            testID="home-toggle-account-number"
          >
            <AppIcon color={colors.onPrimary} name={isAccountNumberVisible ? "eyeOff" : "eye"} size={16} />
            <Text style={styles.textActionLabel}>{isAccountNumberLoading ? "Đang tải" : isAccountNumberVisible ? "Ẩn" : "Hiện đầy đủ"}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sao chép đầy đủ số tài khoản"
            disabled={isCopyingAccountNumber || isAccountNumberLoading}
            onPress={onCopyAccountNumber}
            style={({ pressed }) => [styles.textAction, pressed ? styles.pressed : null, isCopyingAccountNumber || isAccountNumberLoading ? styles.disabled : null]}
            testID="home-copy-account-number"
          >
            <AppIcon color={colors.onPrimary} name="copy" size={16} />
            <Text style={styles.textActionLabel}>{isCopyingAccountNumber ? "Đang sao chép" : "Sao chép"}</Text>
          </Pressable>
        </View>

        <View style={styles.balanceGrid}>
          <View style={styles.balanceCell}>
            <Text style={styles.balanceLabel}>Khả dụng</Text>
            <Text numberOfLines={1} adjustsFontSizeToFit style={styles.balanceValue}>{getBalanceDisplay(account.availableBalance.amountMinor, isBalanceVisible)}</Text>
          </View>
          <View style={styles.balanceDivider} />
          <View style={styles.balanceCell}>
            <Text style={styles.balanceLabel}>Hiện tại</Text>
            <Text numberOfLines={1} adjustsFontSizeToFit style={styles.balanceValue}>{getBalanceDisplay(account.currentBalance.amountMinor, isBalanceVisible)}</Text>
          </View>
        </View>

        <View style={styles.statusPill}>
          <View style={[styles.statusDot, account.status === "BLOCKED" ? styles.statusDotBlocked : null]} />
          <Text style={styles.statusText}>{getAccountStatusLabel(account.status)}</Text>
        </View>
      </View>
      {accountNumberError ? (
        <RequestErrorNotice
          error={accountNumberError}
          fallbackMessage="Không thể tải số tài khoản đầy đủ. Vui lòng thử lại."
          onRetry={onRetryAccountNumber}
          testID="home-account-number-error"
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  card: { position: "relative", overflow: "hidden", gap: spacing.md, padding: spacing.lg, borderRadius: radius.xl, backgroundColor: colors.navy, ...shadows.floating },
  decorativeOrbLarge: { position: "absolute", top: -90, right: -70, width: 230, height: 230, borderRadius: 115, backgroundColor: "rgba(21,94,239,0.38)" },
  decorativeOrbSmall: { position: "absolute", bottom: -90, left: -60, width: 180, height: 180, borderRadius: 90, backgroundColor: "rgba(99,214,197,0.10)" },
  headerRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md },
  titleBlock: { flex: 1, gap: spacing.xs },
  cardLabel: { ...typography.label, color: "rgba(255,255,255,0.70)", letterSpacing: 0.8 },
  totalBalance: { ...typography.amount, color: colors.onPrimary },
  iconAction: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.30)", borderRadius: radius.md, backgroundColor: "rgba(255,255,255,0.10)" },
  accountLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.18)" },
  accountCopy: { flex: 1, gap: 2 },
  accountName: { ...typography.bodyStrong, color: colors.onPrimary },
  accountNumber: { ...typography.body, color: "rgba(255,255,255,0.72)", letterSpacing: 0.5 },
  accountActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  textAction: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: spacing.smd, borderWidth: 1, borderColor: "rgba(255,255,255,0.28)", borderRadius: radius.sm, backgroundColor: "rgba(255,255,255,0.08)" },
  textActionLabel: { ...typography.caption, color: colors.onPrimary, fontWeight: "700" },
  balanceGrid: { flexDirection: "row", gap: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.18)" },
  balanceCell: { flex: 1, gap: spacing.xs },
  balanceDivider: { width: 1, backgroundColor: "rgba(255,255,255,0.18)" },
  balanceLabel: { ...typography.caption, color: "rgba(255,255,255,0.64)" },
  balanceValue: { ...typography.bodyStrong, color: colors.onPrimary },
  statusPill: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: spacing.smd, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: "rgba(255,255,255,0.12)" },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#63D6C5" },
  statusDotBlocked: { backgroundColor: "#FF8A80" },
  statusText: { ...typography.caption, color: colors.onPrimary, fontWeight: "700" },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.5 },
});
