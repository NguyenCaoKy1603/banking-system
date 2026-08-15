import { useCallback, useMemo, useState } from "react";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { Screen } from "@/components/ui/Screen";
import { useAuth } from "@/features/auth/context/AuthContext";
import { formatVndMinor } from "@/features/banking/presentation/formatMoney";
import { getCreditTransactionTypeLabel } from "@/features/credit/presentation/creditPresentation";
import { getCreditCard, listCreditTransactions } from "@/features/credit/services/creditApi";
import type { CreditTransaction } from "@/features/credit/types/credit";
import { ApiError } from "@/services/api/ApiError";
import { colors, spacing } from "@/theme";

function getErrorMessage(error: unknown): string { return error instanceof ApiError ? error.message : "Không thể tải giao dịch thẻ."; }

export function CreditTransactionsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ cardId?: string }>();
  const cardId = typeof params.cardId === "string" ? params.cardId : "";
  const { deviceId, refreshAccessToken, session } = useAuth();
  const accessToken = session?.accessToken ?? null;
  const auth = useMemo(() => ({ accessToken, deviceId, refreshAccessToken }), [accessToken, deviceId, refreshAccessToken]);
  const [items, setItems] = useState<CreditTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    if (!accessToken || !cardId) { setIsLoading(false); return; }
    setIsLoading(true); setError(undefined);
    try {
      const detail = await getCreditCard(cardId, auth);
      setItems((await listCreditTransactions(detail.creditAccount.creditAccountId, { auth, limit: 100 })).items);
    } catch (requestError: unknown) { setError(getErrorMessage(requestError)); }
    finally { setIsLoading(false); }
  }, [accessToken, auth, cardId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return <Screen><ScrollView contentContainerStyle={styles.content}>
    <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.backButton} testID="credit-transactions-back"><Text style={styles.backLabel}>‹ Quay lại</Text></Pressable>
    <View style={styles.header}><Text style={styles.eyebrow}>M7 · CREDIT</Text><Text style={styles.title}>Giao dịch thẻ</Text><Text style={styles.description}>Giao dịch được cập nhật từ backend; không tự cộng/trừ ở Mobile.</Text></View>
    {isLoading ? <View style={styles.centerState} testID="credit-transactions-loading"><ActivityIndicator color={colors.primary} size="large" /></View> : error ? <View style={styles.card}><Text style={styles.errorText}>{error}</Text><PrimaryButton label="Thử lại" onPress={load} testID="credit-transactions-retry" /></View> : items.length === 0 ? <View style={styles.card} testID="credit-transactions-empty"><Text style={styles.emptyText}>Chưa có giao dịch.</Text></View> : <View style={styles.list} testID="credit-transactions-list">{items.map((item) => <View key={item.transactionId} style={styles.row}><View style={styles.rowMain}><Text style={styles.rowTitle}>{getCreditTransactionTypeLabel(item.type)}</Text><Text style={styles.rowDescription}>{item.description}</Text><Text style={styles.rowDate}>{new Date(item.occurredAt).toLocaleString("vi-VN")}</Text></View><Text style={[styles.amount, item.debtEffect === "DECREASE" ? styles.decrease : null]}>{item.debtEffect === "DECREASE" ? "−" : item.debtEffect === "INCREASE" ? "+" : ""}{formatVndMinor(item.amount.amountMinor)}</Text></View>)}</View>}
  </ScrollView></Screen>;
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, width: "100%", maxWidth: 720, alignSelf: "center", padding: spacing.lg, gap: spacing.lg },
  backButton: { alignSelf: "flex-start", paddingVertical: spacing.xs }, backLabel: { color: colors.primary, fontSize: 15, fontWeight: "600" },
  header: { gap: spacing.sm }, eyebrow: { color: colors.primary, fontSize: 12, fontWeight: "700", letterSpacing: 1.4 }, title: { color: colors.text, fontSize: 30, fontWeight: "700" }, description: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  centerState: { minHeight: 220, alignItems: "center", justifyContent: "center" }, card: { gap: spacing.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: 20, backgroundColor: colors.surface }, list: { borderWidth: 1, borderColor: colors.border, borderRadius: 20, backgroundColor: colors.surface, overflow: "hidden" },
  row: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md, padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }, rowMain: { flex: 1, gap: spacing.xs }, rowTitle: { color: colors.text, fontSize: 16, fontWeight: "800" }, rowDescription: { color: colors.muted, fontSize: 13 }, rowDate: { color: colors.muted, fontSize: 12 }, amount: { color: colors.danger, fontSize: 15, fontWeight: "800", textAlign: "right" }, decrease: { color: colors.success }, emptyText: { color: colors.text, fontSize: 16, fontWeight: "700" }, errorText: { color: colors.danger, fontSize: 14, lineHeight: 20 },
});
