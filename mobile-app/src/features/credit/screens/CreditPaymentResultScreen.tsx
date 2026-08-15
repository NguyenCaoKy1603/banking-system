import { useCallback, useMemo, useState } from "react";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { Screen } from "@/components/ui/Screen";
import { useAuth } from "@/features/auth/context/AuthContext";
import { formatVndMinor } from "@/features/banking/presentation/formatMoney";
import { getCreditPaymentStatusLabel } from "@/features/credit/presentation/creditPresentation";
import { getCreditPayment } from "@/features/credit/services/creditApi";
import type { CreditPayment } from "@/features/credit/types/credit";
import { ApiError } from "@/services/api/ApiError";
import { colors, spacing } from "@/theme";

export function CreditPaymentResultScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ cardId?: string; paymentId?: string }>();
  const cardId = typeof params.cardId === "string" ? params.cardId : "";
  const paymentId = typeof params.paymentId === "string" ? params.paymentId : "";
  const { deviceId, refreshAccessToken, session } = useAuth();
  const auth = useMemo(() => ({ accessToken: session?.accessToken ?? null, deviceId, refreshAccessToken }), [deviceId, refreshAccessToken, session?.accessToken]);
  const [payment, setPayment] = useState<CreditPayment | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const load = useCallback(async () => { if (!auth.accessToken || !paymentId) { setIsLoading(false); return; } setIsLoading(true); setError(undefined); try { setPayment(await getCreditPayment(paymentId, auth)); } catch (requestError: unknown) { setError(requestError instanceof ApiError ? requestError.message : "Không thể tải trạng thái thanh toán."); } finally { setIsLoading(false); } }, [auth, paymentId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  return <Screen><ScrollView contentContainerStyle={styles.content}><Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.backButton}><Text style={styles.backLabel}>‹ Quay lại</Text></Pressable><Text style={styles.eyebrow}>M7 · PAYMENT RESULT</Text><Text style={styles.title}>Trạng thái thanh toán</Text>{isLoading ? <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /></View> : error ? <View style={styles.card}><Text style={styles.error}>{error}</Text><PrimaryButton label="Thử lại" onPress={load} /></View> : payment ? <View style={styles.card} testID="credit-payment-result-route"><Text style={styles.status}>{getCreditPaymentStatusLabel(payment.status)}</Text><Text style={styles.amount}>{formatVndMinor(payment.amount.amountMinor)}</Text><Text style={styles.meta}>{payment.reference}</Text><PrimaryButton label="Về chi tiết thẻ" onPress={() => router.replace({ pathname: "/cards/[cardId]", params: { cardId } })} /></View> : <View style={styles.card}><Text style={styles.meta}>Không tìm thấy thanh toán.</Text></View>}</ScrollView></Screen>;
}

const styles = StyleSheet.create({ content: { flexGrow: 1, width: "100%", maxWidth: 720, alignSelf: "center", padding: spacing.lg, gap: spacing.lg }, backButton: { alignSelf: "flex-start", paddingVertical: spacing.xs }, backLabel: { color: colors.primary, fontSize: 15, fontWeight: "600" }, eyebrow: { color: colors.primary, fontSize: 12, fontWeight: "700", letterSpacing: 1.4 }, title: { color: colors.text, fontSize: 30, fontWeight: "700" }, center: { minHeight: 220, alignItems: "center", justifyContent: "center" }, card: { gap: spacing.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: 20, backgroundColor: colors.surface }, status: { color: colors.primary, fontSize: 20, fontWeight: "800" }, amount: { color: colors.text, fontSize: 30, fontWeight: "800" }, meta: { color: colors.muted, fontSize: 14 }, error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
});
