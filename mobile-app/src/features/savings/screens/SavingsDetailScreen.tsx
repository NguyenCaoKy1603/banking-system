import { useCallback, useMemo, useState } from "react";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { Screen } from "@/components/ui/Screen";
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
import { colors, spacing } from "@/theme";

function getErrorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "Không thể tải chi tiết tiền gửi. Vui lòng thử lại.";
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("vi-VN");
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
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => router.back()}
          style={styles.backButton}
          testID="savings-detail-back"
        >
          <Text style={styles.backLabel}>‹ Quay lại</Text>
        </Pressable>

        <View style={styles.header}>
          <Text style={styles.eyebrow}>M6 · TIỀN GỬI</Text>
          <Text style={styles.title}>Chi tiết khoản tiền gửi</Text>
          <Text style={styles.description}>Mọi số liệu dưới đây là snapshot do backend trả về.</Text>
        </View>

        {isLoading ? (
          <View style={styles.centerState} testID="savings-detail-loading">
            <ActivityIndicator color={colors.primary} size="large" />
          </View>
        ) : error ? (
          <View style={styles.card} testID="savings-detail-error">
            <Text style={styles.errorText}>{error}</Text>
            <PrimaryButton label="Thử lại" onPress={loadDeposit} testID="savings-detail-retry" />
          </View>
        ) : deposit ? (
          <View style={styles.stack} testID="savings-detail">
            <View style={styles.heroCard}>
              <View style={styles.heroTopRow}>
                <Text style={styles.heroTitle}>{deposit.productName}</Text>
                <Text style={styles.status}>{getSavingsDepositStatusLabel(deposit.status)}</Text>
              </View>
              <Text style={styles.heroAmount}>{formatVndMinor(deposit.principal.amountMinor)}</Text>
              <Text style={styles.heroMeta}>{deposit.termMonths} tháng · {formatSavingsRate(deposit.annualRateBasisPoints)}</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Thông tin khoản gửi</Text>
              <SummaryRow label="Lãi dự kiến" value={formatVndMinor(deposit.expectedInterest.amountMinor)} />
              <SummaryRow label="Tổng khi đáo hạn" value={formatVndMinor(deposit.totalAtMaturity.amountMinor)} />
              <SummaryRow label="Ngày mở" value={formatDate(deposit.openedAt)} />
              <SummaryRow label="Ngày đáo hạn" value={formatDate(deposit.maturityAt)} />
              <SummaryRow label="Chỉ thị đáo hạn" value={getMaturityInstructionLabel(deposit.maturityInstruction)} />
              <SummaryRow label="Tài khoản nguồn" value={deposit.sourceAccountMaskedNumber} />
              <SummaryRow label="Mã tham chiếu" value={deposit.reference} />
            </View>

            <View style={styles.noticeCard}>
              <Text style={styles.noticeTitle}>Phạm vi sandbox</Text>
              <Text style={styles.noticeText}>
                Chưa hỗ trợ rút trước hạn, nộp thêm hoặc tất toán một phần. Khoản gửi chỉ chuyển trạng thái theo worker mô phỏng đáo hạn.
              </Text>
            </View>

            <PrimaryButton label="Làm mới trạng thái" onPress={loadDeposit} testID="savings-detail-refresh" />
          </View>
        ) : null}
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
  content: { flexGrow: 1, width: "100%", maxWidth: 720, alignSelf: "center", padding: spacing.lg, gap: spacing.lg },
  backButton: { alignSelf: "flex-start", paddingVertical: spacing.xs },
  backLabel: { color: colors.primary, fontSize: 15, fontWeight: "600" },
  header: { gap: spacing.sm },
  eyebrow: { color: colors.primary, fontSize: 12, fontWeight: "700", letterSpacing: 1.4 },
  title: { color: colors.text, fontSize: 30, fontWeight: "700" },
  description: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  centerState: { minHeight: 220, alignItems: "center", justifyContent: "center" },
  stack: { gap: spacing.md },
  heroCard: { gap: spacing.sm, padding: spacing.lg, borderRadius: 24, backgroundColor: colors.primary },
  heroTopRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md },
  heroTitle: { flex: 1, color: colors.surface, fontSize: 18, fontWeight: "800" },
  status: { color: "rgba(255,255,255,0.85)", fontSize: 12, fontWeight: "800", textAlign: "right" },
  heroAmount: { color: colors.surface, fontSize: 30, fontWeight: "800" },
  heroMeta: { color: "rgba(255,255,255,0.8)", fontSize: 14 },
  card: { gap: spacing.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: 20, backgroundColor: colors.surface },
  cardTitle: { color: colors.text, fontSize: 18, fontWeight: "800" },
  summaryRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md },
  summaryLabel: { color: colors.muted, fontSize: 14 },
  summaryValue: { flex: 1, color: colors.text, fontSize: 14, fontWeight: "700", textAlign: "right" },
  noticeCard: { gap: spacing.sm, padding: spacing.lg, borderRadius: 20, backgroundColor: colors.primarySoft },
  noticeTitle: { color: colors.primary, fontSize: 15, fontWeight: "800" },
  noticeText: { color: colors.text, fontSize: 14, lineHeight: 21 },
  errorText: { color: colors.danger, fontSize: 14, lineHeight: 20 },
});
