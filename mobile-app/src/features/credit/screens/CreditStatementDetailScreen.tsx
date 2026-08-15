import { useCallback, useMemo, useState } from "react";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { Screen } from "@/components/ui/Screen";
import { useAuth } from "@/features/auth/context/AuthContext";
import { formatVndMinor } from "@/features/banking/presentation/formatMoney";
import { formatCreditDate, getCreditPaymentStatusLabel, getCreditStatementStatusLabel, getCreditTransactionTypeLabel } from "@/features/credit/presentation/creditPresentation";
import { getCreditCard, getCreditStatement } from "@/features/credit/services/creditApi";
import type { CreditStatement } from "@/features/credit/types/credit";
import { ApiError } from "@/services/api/ApiError";
import { colors, spacing } from "@/theme";

function getErrorMessage(error: unknown): string { return error instanceof ApiError ? error.message : "Không thể tải chi tiết sao kê."; }
function SummaryRow({ label, value }: { label: string; value: string }) { return <View style={styles.summaryRow}><Text style={styles.label}>{label}</Text><Text style={styles.value}>{value}</Text></View>; }

export function CreditStatementDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ cardId?: string; statementId?: string }>();
  const cardId = typeof params.cardId === "string" ? params.cardId : "";
  const statementId = typeof params.statementId === "string" ? params.statementId : "";
  const { deviceId, refreshAccessToken, session } = useAuth();
  const accessToken = session?.accessToken ?? null;
  const auth = useMemo(() => ({ accessToken, deviceId, refreshAccessToken }), [accessToken, deviceId, refreshAccessToken]);
  const [statement, setStatement] = useState<CreditStatement | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    if (!accessToken || !cardId || !statementId) { setIsLoading(false); return; }
    setIsLoading(true); setError(undefined);
    try { const detail = await getCreditCard(cardId, auth); setStatement(await getCreditStatement(detail.creditAccount.creditAccountId, statementId, auth)); }
    catch (requestError: unknown) { setError(getErrorMessage(requestError)); }
    finally { setIsLoading(false); }
  }, [accessToken, auth, cardId, statementId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return <Screen><ScrollView contentContainerStyle={styles.content}>
    <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.backButton} testID="credit-statement-detail-back"><Text style={styles.backLabel}>‹ Quay lại</Text></Pressable>
    <View style={styles.header}><Text style={styles.eyebrow}>M7 · STATEMENT</Text><Text style={styles.title}>Chi tiết sao kê</Text></View>
    {isLoading ? <View style={styles.centerState}><ActivityIndicator color={colors.primary} size="large" /></View> : error ? <View style={styles.card}><Text style={styles.errorText}>{error}</Text><PrimaryButton label="Thử lại" onPress={load} /></View> : statement ? <>
      <View style={styles.heroCard} testID="credit-statement-detail"><Text style={styles.heroTitle}>{getCreditStatementStatusLabel(statement.status)}</Text><Text style={styles.heroAmount}>{formatVndMinor(statement.remainingAmountDue.amountMinor)}</Text><Text style={styles.heroMeta}>Còn phải trả · hạn {formatCreditDate(statement.dueAt)}</Text></View>
      <View style={styles.card}><Text style={styles.sectionTitle}>Tổng hợp</Text><SummaryRow label="Dư đầu kỳ" value={formatVndMinor(statement.openingBalance.amountMinor)} /><SummaryRow label="Mua hàng" value={formatVndMinor(statement.purchaseTotal.amountMinor)} /><SummaryRow label="Hoàn tiền" value={formatVndMinor(statement.refundTotal.amountMinor)} /><SummaryRow label="Đã thanh toán" value={formatVndMinor(statement.paidAmount.amountMinor)} /><SummaryRow label="Tối thiểu còn lại" value={formatVndMinor(statement.minimumPaymentRemaining.amountMinor)} /></View>
      <View style={styles.card}><Text style={styles.sectionTitle}>Giao dịch trong kỳ</Text>{statement.items.map((item) => <View key={item.transactionId} style={styles.itemRow}><View style={styles.itemMain}><Text style={styles.itemTitle}>{getCreditTransactionTypeLabel(item.type)}</Text><Text style={styles.itemMeta}>{item.description}</Text></View><Text style={styles.itemAmount}>{formatVndMinor(item.amount.amountMinor)}</Text></View>)}</View>
      <View style={styles.card}><Text style={styles.sectionTitle}>Thanh toán</Text>{statement.payments.length === 0 ? <Text style={styles.mutedText}>Chưa có thanh toán.</Text> : statement.payments.map((payment) => <View key={payment.paymentId} style={styles.itemRow}><View style={styles.itemMain}><Text style={styles.itemTitle}>{payment.reference}</Text><Text style={styles.itemMeta}>{getCreditPaymentStatusLabel(payment.status)}</Text></View><Text style={styles.itemAmount}>{formatVndMinor(payment.amount.amountMinor)}</Text></View>)}</View>
      {statement.remainingAmountDue.amountMinor !== "0" ? <PrimaryButton label="Thanh toán sao kê này" onPress={() => router.push({ pathname: "/cards/[cardId]/pay", params: { cardId, statementId: statement.statementId } })} testID="credit-statement-pay" /> : null}
    </> : <View style={styles.card}><Text style={styles.mutedText}>Không tìm thấy sao kê.</Text></View>}
  </ScrollView></Screen>;
}

const styles = StyleSheet.create({ content: { flexGrow: 1, width: "100%", maxWidth: 720, alignSelf: "center", padding: spacing.lg, gap: spacing.lg }, backButton: { alignSelf: "flex-start", paddingVertical: spacing.xs }, backLabel: { color: colors.primary, fontSize: 15, fontWeight: "600" }, header: { gap: spacing.sm }, eyebrow: { color: colors.primary, fontSize: 12, fontWeight: "700", letterSpacing: 1.4 }, title: { color: colors.text, fontSize: 30, fontWeight: "700" }, centerState: { minHeight: 220, alignItems: "center", justifyContent: "center" }, heroCard: { gap: spacing.sm, padding: spacing.lg, borderRadius: 24, backgroundColor: colors.primary }, heroTitle: { color: colors.surface, fontSize: 17, fontWeight: "800" }, heroAmount: { color: colors.surface, fontSize: 30, fontWeight: "800" }, heroMeta: { color: "rgba(255,255,255,0.8)", fontSize: 14 }, card: { gap: spacing.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: 20, backgroundColor: colors.surface }, sectionTitle: { color: colors.text, fontSize: 18, fontWeight: "800" }, summaryRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md }, label: { color: colors.muted, fontSize: 14 }, value: { color: colors.text, fontSize: 14, fontWeight: "800", textAlign: "right" }, itemRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md, paddingVertical: spacing.xs }, itemMain: { flex: 1, gap: spacing.xs }, itemTitle: { color: colors.text, fontSize: 14, fontWeight: "800" }, itemMeta: { color: colors.muted, fontSize: 13 }, itemAmount: { color: colors.text, fontSize: 14, fontWeight: "800" }, mutedText: { color: colors.muted, fontSize: 14 }, errorText: { color: colors.danger, fontSize: 14, lineHeight: 20 },
});
