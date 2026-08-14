import { StyleSheet, Text, View } from "react-native";

import { Screen } from "@/components/ui/Screen";
import { colors, spacing } from "@/theme";

const actions = ["Chuyển tiền", "Quét QR", "Lịch sử"] as const;

export function HomeScreen() {
  return (
    <Screen style={styles.screen}>
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>TỔNG QUAN</Text>
          <Text style={styles.title}>Ngân hàng số</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Tài khoản</Text>
          <View style={styles.accountCard}>
            <Text style={styles.cardLabel}>Tài khoản thanh toán</Text>
            <Text style={styles.emptyState}>Chưa có dữ liệu</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Thao tác nhanh</Text>
          <View style={styles.actions}>
            {actions.map((action) => (
              <View key={action} style={styles.actionCard}>
                <View style={styles.actionIndicator} />
                <Text style={styles.actionLabel}>{action}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.statusCard}>
          <View style={styles.statusDot} />
          <View style={styles.statusContent}>
            <Text style={styles.statusLabel}>Trạng thái hệ thống</Text>
            <Text style={styles.statusText}>Backend chưa kết nối</Text>
          </View>
        </View>
      </View>
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
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    gap: spacing.xl,
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
    fontSize: 32,
    fontWeight: "700",
  },
  section: {
    gap: spacing.sm,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "600",
  },
  accountCard: {
    minHeight: 132,
    justifyContent: "space-between",
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing.md,
    backgroundColor: colors.surface,
  },
  cardLabel: {
    color: colors.muted,
    fontSize: 14,
  },
  emptyState: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "600",
  },
  actions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  actionCard: {
    flex: 1,
    minHeight: 96,
    justifyContent: "space-between",
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing.md,
    backgroundColor: colors.surface,
  },
  actionIndicator: {
    width: spacing.lg,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.primary,
  },
  actionLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "600",
  },
  statusCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing.md,
    backgroundColor: colors.surface,
  },
  statusDot: {
    width: spacing.sm,
    height: spacing.sm,
    borderRadius: spacing.xs,
    backgroundColor: colors.danger,
  },
  statusContent: {
    gap: spacing.xs,
  },
  statusLabel: {
    color: colors.muted,
    fontSize: 12,
  },
  statusText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "600",
  },
});
