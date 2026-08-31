import { useCallback, useMemo, useState } from "react";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { AppHeader } from "@/components/ui/AppHeader";
import { AppIcon } from "@/components/ui/AppIcon";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Screen } from "@/components/ui/Screen";
import { StateCard } from "@/components/ui/StateCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAuth } from "@/features/auth/context/AuthContext";
import { formatVndMinor } from "@/features/banking/presentation/formatMoney";
import {
  formatCreditDate,
  getCreditPaymentStatusLabel,
  getCreditStatementStatusLabel,
  getCreditTransactionTypeLabel,
} from "@/features/credit/presentation/creditPresentation";
import { getCreditCard, getCreditStatement } from "@/features/credit/services/creditApi";
import type { CreditStatement } from "@/features/credit/types/credit";
import { ApiError } from "@/services/api/ApiError";
import { colors, radius, shadows, sizes, spacing, typography } from "@/theme";

function getErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Không thể tải chi tiết sao kê.";
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

function getStatusTone(
  status: CreditStatement["status"],
): "success" | "warning" | "danger" | "info" {
  if (status === "PAID") return "success";
  if (status === "OVERDUE") return "danger";
  if (status === "PARTIALLY_PAID") return "warning";
  return "info";
}

export function CreditStatementDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ cardId?: string; statementId?: string }>();
  const cardId = typeof params.cardId === "string" ? params.cardId : "";
  const statementId = typeof params.statementId === "string" ? params.statementId : "";
  const { deviceId, refreshAccessToken, session } = useAuth();
  const accessToken = session?.accessToken ?? null;
  const auth = useMemo(
    () => ({ accessToken, deviceId, refreshAccessToken }),
    [accessToken, deviceId, refreshAccessToken],
  );
  const [statement, setStatement] = useState<CreditStatement | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    if (!accessToken || !cardId || !statementId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(undefined);
    try {
      const detail = await getCreditCard(cardId, auth);
      setStatement(
        await getCreditStatement(detail.creditAccount.creditAccountId, statementId, auth),
      );
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsLoading(false);
    }
  }, [accessToken, auth, cardId, statementId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <AppHeader
          backTestID="credit-statement-detail-back"
          eyebrow="Quản lý dư nợ"
          onBack={() => router.back()}
          subtitle="Đối chiếu số dư, giao dịch và các khoản thanh toán trong kỳ."
          title="Chi tiết sao kê"
        />

        {isLoading ? (
          <StateCard loading message="Đang tải sao kê..." />
        ) : error ? (
          <StateCard
            actionLabel="Thử lại"
            icon="alert"
            message={error}
            onAction={load}
            title="Không thể tải sao kê"
          />
        ) : statement ? (
          <>
            <View style={styles.heroCard} testID="credit-statement-detail">
              <View style={styles.heroTop}>
                <View style={styles.heroIcon}>
                  <AppIcon color={colors.onPrimary} name="card" size={22} />
                </View>
                <StatusBadge
                  label={getCreditStatementStatusLabel(statement.status)}
                  tone={getStatusTone(statement.status)}
                />
              </View>
              <Text style={styles.heroLabel}>Còn phải trả</Text>
              <Text style={styles.heroAmount}>
                {formatVndMinor(statement.remainingAmountDue.amountMinor)}
              </Text>
              <Text style={styles.heroMeta}>
                Hạn thanh toán {formatCreditDate(statement.dueAt)}
              </Text>
              <Text style={styles.heroCycle}>
                Kỳ {formatCreditDate(statement.cycleStartAt)} – {formatCreditDate(statement.cycleEndAt)}
              </Text>
            </View>

            <Card elevated>
              <Text style={styles.sectionTitle}>Tổng hợp sao kê</Text>
              <SummaryRow label="Dư đầu kỳ" value={formatVndMinor(statement.openingBalance.amountMinor)} />
              <SummaryRow label="Mua hàng" value={formatVndMinor(statement.purchaseTotal.amountMinor)} />
              <SummaryRow label="Hoàn tiền" value={formatVndMinor(statement.refundTotal.amountMinor)} />
              <SummaryRow label="Đã thanh toán" value={formatVndMinor(statement.paidAmount.amountMinor)} />
              <View style={styles.minimumBox}>
                <Text style={styles.minimumLabel}>Tối thiểu còn lại</Text>
                <Text style={styles.minimumValue}>
                  {formatVndMinor(statement.minimumPaymentRemaining.amountMinor)}
                </Text>
              </View>
            </Card>

            <Card>
              <View style={styles.sectionHeader}>
                <AppIcon color={colors.primary} name="history" size={20} />
                <Text style={styles.sectionTitle}>Giao dịch trong kỳ</Text>
              </View>
              {statement.items.length === 0 ? (
                <Text style={styles.mutedText}>Chưa có giao dịch trong kỳ này.</Text>
              ) : (
                statement.items.map((item) => (
                  <View key={item.transactionId} style={styles.itemRow}>
                    <View style={styles.itemMain}>
                      <Text style={styles.itemTitle}>
                        {getCreditTransactionTypeLabel(item.type)}
                      </Text>
                      <Text style={styles.itemMeta}>{item.description}</Text>
                    </View>
                    <Text style={styles.itemAmount}>
                      {formatVndMinor(item.amount.amountMinor)}
                    </Text>
                  </View>
                ))
              )}
            </Card>

            <Card>
              <View style={styles.sectionHeader}>
                <AppIcon color={colors.primary} name="transfer" size={20} />
                <Text style={styles.sectionTitle}>Các khoản thanh toán</Text>
              </View>
              {statement.payments.length === 0 ? (
                <Text style={styles.mutedText}>Chưa có khoản thanh toán.</Text>
              ) : (
                statement.payments.map((payment) => (
                  <View key={payment.paymentId} style={styles.itemRow}>
                    <View style={styles.itemMain}>
                      <Text style={styles.itemTitle}>{payment.reference}</Text>
                      <Text style={styles.itemMeta}>
                        {getCreditPaymentStatusLabel(payment.status)}
                      </Text>
                    </View>
                    <Text style={styles.itemAmount}>
                      {formatVndMinor(payment.amount.amountMinor)}
                    </Text>
                  </View>
                ))
              )}
            </Card>

            {statement.remainingAmountDue.amountMinor !== "0" ? (
              <Button
                icon="transfer"
                label="Thanh toán sao kê này"
                onPress={() =>
                  router.push({
                    pathname: "/cards/[cardId]/pay",
                    params: { cardId, statementId: statement.statementId },
                  })
                }
                testID="credit-statement-pay"
              />
            ) : null}
          </>
        ) : (
          <StateCard icon="card" message="Không tìm thấy sao kê." title="Không có dữ liệu" />
        )}
      </ScrollView>
    </Screen>
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
  heroCard: {
    gap: spacing.sm,
    padding: spacing.mlg,
    borderRadius: radius.xl,
    backgroundColor: colors.navy,
    ...shadows.card,
  },
  heroTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  heroIcon: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  heroLabel: { ...typography.label, color: "rgba(255,255,255,0.72)" },
  heroAmount: { ...typography.amount, color: colors.onPrimary },
  heroMeta: { ...typography.bodyStrong, color: colors.onPrimary },
  heroCycle: { ...typography.caption, color: "rgba(255,255,255,0.68)" },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  sectionTitle: { ...typography.subheading, color: colors.text },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  label: { ...typography.body, color: colors.muted },
  value: { flex: 1, ...typography.bodyStrong, color: colors.text, textAlign: "right" },
  minimumBox: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  minimumLabel: { ...typography.label, color: colors.primary },
  minimumValue: { ...typography.bodyStrong, color: colors.primary },
  itemRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  itemMain: { flex: 1, gap: spacing.xs },
  itemTitle: { ...typography.bodyStrong, color: colors.text },
  itemMeta: { ...typography.caption, color: colors.muted },
  itemAmount: { ...typography.bodyStrong, color: colors.text },
  mutedText: { ...typography.body, color: colors.muted },
});
