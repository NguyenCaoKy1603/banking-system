import { useCallback, useMemo, useState } from "react";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { AppHeader } from "@/components/ui/AppHeader";
import { AppIcon } from "@/components/ui/AppIcon";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EnvironmentBadge } from "@/components/ui/EnvironmentBadge";
import { Screen } from "@/components/ui/Screen";
import { StateCard } from "@/components/ui/StateCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAuth } from "@/features/auth/context/AuthContext";
import { formatVndMinor } from "@/features/banking/presentation/formatMoney";
import {
  formatSavingsRate,
  getMaturityInstructionLabel,
  getSavingsDepositStatusLabel,
} from "@/features/savings/presentation/savingsPresentation";
import { getSavingsDeposit } from "@/features/savings/services/savingsApi";
import type { SavingsDeposit } from "@/features/savings/types/savings";
import { ApiError } from "@/services/api/ApiError";
import { colors, radius, shadows, sizes, spacing, typography } from "@/theme";

function getErrorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "Không thể tải chi tiết tiền gửi. Vui lòng thử lại.";
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("vi-VN");
}

export function SavingsDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ depositId?: string }>();
  const depositId = typeof params.depositId === "string" ? params.depositId : "";
  const { deviceId, refreshAccessToken, session } = useAuth();
  const accessToken = session?.accessToken ?? null;
  const auth = useMemo(
    () => ({ accessToken, deviceId, refreshAccessToken }),
    [accessToken, deviceId, refreshAccessToken],
  );
  const [deposit, setDeposit] = useState<SavingsDeposit | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  const loadDeposit = useCallback(async () => {
    if (!accessToken || !depositId) {
      setDeposit(null);
      setError("Khoản tiền gửi không hợp lệ hoặc phiên đã hết hạn.");
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(undefined);
    try {
      setDeposit(await getSavingsDeposit(depositId, auth));
    } catch (requestError: unknown) {
      setDeposit(null);
      setError(getErrorMessage(requestError));
    } finally {
      setIsLoading(false);
    }
  }, [accessToken, auth, depositId]);

  useFocusEffect(
    useCallback(() => {
      void loadDeposit();
    }, [loadDeposit]),
  );

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <AppHeader
          backTestID="savings-detail-back"
          eyebrow="Tích lũy"
          onBack={() => router.back()}
          subtitle="Theo dõi giá trị, lãi dự kiến và phương án khi đáo hạn."
          title="Chi tiết tiền gửi"
        />
        <EnvironmentBadge />

        {isLoading ? (
          <StateCard loading message="Đang tải khoản tiền gửi..." testID="savings-detail-loading" />
        ) : error ? (
          <StateCard
            actionLabel="Thử lại"
            actionTestID="savings-detail-retry"
            icon="alert"
            message={error}
            onAction={loadDeposit}
            testID="savings-detail-error"
            title="Không thể tải dữ liệu"
          />
        ) : deposit ? (
          <View style={styles.stack} testID="savings-detail">
            <View style={styles.heroCard}>
              <View style={styles.heroTopRow}>
                <View style={styles.heroIcon}>
                  <AppIcon color={colors.onPrimary} name="savings" size={22} />
                </View>
                <StatusBadge
                  label={getSavingsDepositStatusLabel(deposit.status)}
                  tone={deposit.status === "ACTIVE" ? "success" : "neutral"}
                />
              </View>
              <Text style={styles.heroLabel}>Tiền gốc</Text>
              <Text style={styles.heroAmount}>{formatVndMinor(deposit.principal.amountMinor)}</Text>
              <View style={styles.heroBottom}>
                <View>
                  <Text style={styles.heroCaption}>Kỳ hạn</Text>
                  <Text style={styles.heroValue}>{deposit.termMonths} tháng</Text>
                </View>
                <View style={styles.heroRight}>
                  <Text style={styles.heroCaption}>Lãi suất</Text>
                  <Text style={styles.heroValue}>{formatSavingsRate(deposit.annualRateBasisPoints)}</Text>
                </View>
              </View>
            </View>

            <Card elevated>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionIcon}>
                  <AppIcon color={colors.primary} name="history" size={19} />
                </View>
                <Text style={styles.cardTitle}>Giá trị khi đáo hạn</Text>
              </View>
              <View style={styles.highlight}>
                <Text style={styles.highlightLabel}>Tổng tiền dự kiến</Text>
                <Text style={styles.highlightValue}>
                  {formatVndMinor(deposit.totalAtMaturity.amountMinor)}
                </Text>
                <Text style={styles.highlightMeta}>
                  Bao gồm lãi dự kiến {formatVndMinor(deposit.expectedInterest.amountMinor)}
                </Text>
              </View>
              <SummaryRow label="Ngày mở" value={formatDate(deposit.openedAt)} />
              <SummaryRow label="Ngày đáo hạn" value={formatDate(deposit.maturityAt)} />
              <SummaryRow
                label="Phương án đáo hạn"
                value={getMaturityInstructionLabel(deposit.maturityInstruction)}
              />
            </Card>

            <Card>
              <Text style={styles.cardTitle}>Thông tin khoản gửi</Text>
              <SummaryRow label="Sản phẩm" value={deposit.productName} />
              <SummaryRow label="Tài khoản nguồn" value={deposit.sourceAccountMaskedNumber} />
              <SummaryRow label="Mã tham chiếu" value={deposit.reference} />
            </Card>

            <View style={styles.noticeCard}>
              <AppIcon color={colors.info} name="account" size={20} />
              <View style={styles.noticeCopy}>
                <Text style={styles.noticeTitle}>Lưu ý về sản phẩm</Text>
                <Text style={styles.noticeText}>
                  Hiện chưa hỗ trợ rút trước hạn, nộp thêm hoặc tất toán một phần.
                </Text>
              </View>
            </View>

            <Button
              icon="history"
              label="Làm mới trạng thái"
              onPress={loadDeposit}
              testID="savings-detail-refresh"
              variant="outline"
            />
          </View>
        ) : (
          <StateCard icon="savings" message="Khoản tiền gửi không còn khả dụng." title="Không có dữ liệu" />
        )}
      </ScrollView>
    </Screen>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
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
  stack: { gap: spacing.md },
  heroCard: {
    gap: spacing.sm,
    padding: spacing.mlg,
    borderRadius: radius.xl,
    backgroundColor: colors.navy,
    ...shadows.card,
  },
  heroTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
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
  heroBottom: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.18)",
  },
  heroRight: { alignItems: "flex-end" },
  heroCaption: { ...typography.caption, color: "rgba(255,255,255,0.62)" },
  heroValue: { ...typography.bodyStrong, color: colors.onPrimary },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  sectionIcon: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
  },
  cardTitle: { ...typography.subheading, color: colors.text },
  highlight: {
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.successSoft,
  },
  highlightLabel: { ...typography.caption, color: colors.success },
  highlightValue: { ...typography.heading, color: colors.success },
  highlightMeta: { ...typography.caption, color: colors.muted },
  summaryRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  summaryLabel: { ...typography.body, color: colors.muted },
  summaryValue: { flex: 1, ...typography.bodyStrong, color: colors.text, textAlign: "right" },
  noticeCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.infoSoft,
  },
  noticeCopy: { flex: 1, gap: spacing.xs },
  noticeTitle: { ...typography.label, color: colors.info },
  noticeText: { ...typography.body, color: colors.text },
});
