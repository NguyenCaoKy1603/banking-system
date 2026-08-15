import { useCallback, useMemo, useState } from "react";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { Screen } from "@/components/ui/Screen";
import { TextField } from "@/components/ui/TextField";
import { useAuth } from "@/features/auth/context/AuthContext";
import { formatVndMinor } from "@/features/banking/presentation/formatMoney";
import { getCreditCardStatusLabel, getCreditStatementStatusLabel } from "@/features/credit/presentation/creditPresentation";
import { getCreditCard, lockCreditCard, unlockCreditCard } from "@/features/credit/services/creditApi";
import type { CreditCardDetailResponse, CreditStepUpMethod } from "@/features/credit/types/credit";
import { ApiError } from "@/services/api/ApiError";
import { getSandboxBiometricProof, requestBiometricAuthentication } from "@/services/security/biometricAuth";
import { colors, spacing } from "@/theme";

function getErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Không thể tải chi tiết thẻ. Vui lòng thử lại.";
}

function SummaryRow({ label, value, dark = false }: { label: string; value: string; dark?: boolean }) {
  return <View style={styles.summaryRow}><Text style={[styles.label, dark ? styles.darkLabel : null]}>{label}</Text><Text style={[styles.value, dark ? styles.darkValue : null]}>{value}</Text></View>;
}

export function CardDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ cardId?: string }>();
  const cardId = typeof params.cardId === "string" ? params.cardId : "";
  const { deviceId, refreshAccessToken, session } = useAuth();
  const accessToken = session?.accessToken ?? null;
  const auth = useMemo(() => ({ accessToken, deviceId, refreshAccessToken }), [accessToken, deviceId, refreshAccessToken]);
  const [detail, setDetail] = useState<CreditCardDetailResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [stepUpMethod, setStepUpMethod] = useState<CreditStepUpMethod>("OTP");
  const [stepUpProof, setStepUpProof] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();

  const loadCard = useCallback(async () => {
    if (!accessToken || !cardId) {
      setDetail(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(undefined);
    try {
      setDetail(await getCreditCard(cardId, auth));
    } catch (requestError: unknown) {
      setDetail(null);
      setError(getErrorMessage(requestError));
    } finally {
      setIsLoading(false);
    }
  }, [accessToken, auth, cardId]);

  useFocusEffect(useCallback(() => { void loadCard(); }, [loadCard]));

  const handleToggleLock = useCallback(async () => {
    const card = detail?.card;
    if (!card || isSaving) return;
    setIsSaving(true);
    setError(undefined);
    setNotice(undefined);
    try {
      if (card.status === "ACTIVE") {
        const response = await lockCreditCard(card.cardId, auth);
        setDetail((current) => current ? { ...current, card: response.card } : current);
        setNotice("Thẻ đã được khóa trong sandbox.");
      } else if (card.status === "LOCKED") {
        let proof = stepUpProof.trim();
        if (stepUpMethod === "BIOMETRIC") {
          await requestBiometricAuthentication("Xác thực để mở khóa thẻ sandbox");
          proof = getSandboxBiometricProof();
        }
        if (!proof) {
          setError("Cần nhập mã OTP sandbox hoặc xác thực sinh trắc học để mở khóa.");
          return;
        }
        const response = await unlockCreditCard(card.cardId, { method: stepUpMethod, proof }, auth);
        setDetail((current) => current ? { ...current, card: response.card } : current);
        setStepUpProof("");
        setNotice("Thẻ đã được mở khóa sau bước xác thực.");
      } else {
        setError("Card status does not allow this lock or unlock action.");
      }
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsSaving(false);
    }
  }, [auth, detail, isSaving, stepUpMethod, stepUpProof]);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.backButton} testID="card-detail-back"><Text style={styles.backLabel}>‹ Quay lại</Text></Pressable>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>M7 · CREDIT DETAIL</Text>
          <Text style={styles.title}>Chi tiết thẻ tín dụng</Text>
          <Text style={styles.description}>Chỉ hiển thị dữ liệu sandbox cần cho đồ án. Không có PAN, CVV hoặc PIN.</Text>
        </View>

        {isLoading ? (
          <View style={styles.centerState} testID="credit-card-detail-loading"><ActivityIndicator color={colors.primary} size="large" /></View>
        ) : error && !detail ? (
          <View style={styles.card} testID="credit-card-detail-error"><Text style={styles.errorText}>{error}</Text><PrimaryButton label="Thử lại" onPress={loadCard} testID="credit-card-detail-retry" /></View>
        ) : detail ? (
          <>
            <View style={styles.heroCard} testID="credit-card-detail">
              <View style={styles.heroTop}><View style={styles.heroText}><Text style={styles.heroTitle}>{detail.card.displayName}</Text><Text style={styles.heroMeta}>{detail.card.brand} · •••• {detail.card.lastFour}</Text></View><Text style={styles.heroStatus}>{getCreditCardStatusLabel(detail.card.status)}</Text></View>
              <Text style={styles.sandboxBadge}>SANDBOX</Text>
              <SummaryRow dark label="Hạn mức" value={formatVndMinor(detail.card.creditLimit.amountMinor)} />
              <SummaryRow dark label="Dư nợ đã ghi nhận" value={formatVndMinor(detail.card.postedOutstanding.amountMinor)} />
              <SummaryRow dark label="Đang chờ" value={formatVndMinor(detail.card.pendingAuthorizations.amountMinor)} />
              <SummaryRow dark label="Còn khả dụng" value={formatVndMinor(detail.card.availableCredit.amountMinor)} />
            </View>
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Sao kê gần nhất</Text>
              {detail.latestStatement ? (
                <>
                  <SummaryRow label="Trạng thái" value={getCreditStatementStatusLabel(detail.latestStatement.status)} />
                  <SummaryRow label="Hạn thanh toán" value={new Date(detail.latestStatement.dueAt).toLocaleDateString("vi-VN")} />
                  <SummaryRow label="Còn phải trả" value={formatVndMinor(detail.latestStatement.remainingAmountDue.amountMinor)} />
                  <SummaryRow label="Tối thiểu còn lại" value={formatVndMinor(detail.latestStatement.minimumPaymentRemaining.amountMinor)} />
                </>
              ) : <Text style={styles.mutedText}>Chưa có sao kê.</Text>}
            </View>
            {detail.card.status === "LOCKED" ? (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>Mở khóa thẻ</Text>
                <View style={styles.methodRow}>
                  <Pressable onPress={() => setStepUpMethod("OTP")} style={[styles.methodButton, stepUpMethod === "OTP" ? styles.methodSelected : null]} testID="credit-unlock-otp"><Text style={styles.methodLabel}>OTP</Text></Pressable>
                  <Pressable onPress={() => setStepUpMethod("BIOMETRIC")} style={[styles.methodButton, stepUpMethod === "BIOMETRIC" ? styles.methodSelected : null]} testID="credit-unlock-biometric"><Text style={styles.methodLabel}>Sinh trắc học</Text></Pressable>
                </View>
                {stepUpMethod === "OTP" ? <TextField accessibilityLabel="Mã xác thực mở khóa thẻ" keyboardType="number-pad" label="Mã OTP sandbox" onChangeText={setStepUpProof} secureTextEntry testID="credit-unlock-code" value={stepUpProof} /> : null}
              </View>
            ) : null}
            <PrimaryButton disabled={isSaving || (detail.card.status !== "ACTIVE" && detail.card.status !== "LOCKED")} label={detail.card.status === "ACTIVE" ? "Khóa thẻ" : detail.card.status === "LOCKED" ? "Mở khóa thẻ" : "Không thể thao tác"} onPress={() => void handleToggleLock()} testID="card-toggle-lock" />
            <View style={styles.actionGrid}>
              <PrimaryButton label="Giao dịch thẻ" onPress={() => router.push({ pathname: "/cards/[cardId]/transactions", params: { cardId: detail.card.cardId } })} testID="credit-open-transactions" />
              <PrimaryButton label="Sao kê" onPress={() => router.push({ pathname: "/cards/[cardId]/statements", params: { cardId: detail.card.cardId } })} testID="credit-open-statements" />
              <PrimaryButton label="Thanh toán thẻ" onPress={() => router.push({ pathname: "/cards/[cardId]/pay", params: { cardId: detail.card.cardId } })} testID="credit-open-payment" />
            </View>
          </>
        ) : <View style={styles.card}><Text style={styles.mutedText}>Không tìm thấy thẻ trong phiên hiện tại.</Text></View>}
        {error && detail ? <Text style={styles.errorText}>{error}</Text> : null}
        {notice ? <Text style={styles.noticeText}>{notice}</Text> : null}
      </ScrollView>
    </Screen>
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
  heroCard: { gap: spacing.md, padding: spacing.lg, borderRadius: 24, backgroundColor: colors.primary },
  heroTop: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  heroText: { flex: 1, gap: spacing.xs },
  heroTitle: { color: colors.surface, fontSize: 21, fontWeight: "800" },
  heroMeta: { color: "rgba(255,255,255,0.82)", fontSize: 15 },
  heroStatus: { color: colors.surface, fontSize: 12, fontWeight: "800", textAlign: "right" },
  sandboxBadge: { alignSelf: "flex-start", color: colors.surface, fontSize: 11, fontWeight: "800", letterSpacing: 1.5 },
  card: { gap: spacing.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: 20, backgroundColor: colors.surface },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: "800" },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  label: { color: colors.muted, fontSize: 14 },
  value: { color: colors.text, fontSize: 14, fontWeight: "800", textAlign: "right" },
  darkLabel: { color: "rgba(255,255,255,0.78)" },
  darkValue: { color: colors.surface },
  mutedText: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  methodRow: { flexDirection: "row", gap: spacing.sm },
  methodButton: { minHeight: 44, flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: 12 },
  methodSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  methodLabel: { color: colors.primary, fontWeight: "700" },
  actionGrid: { gap: spacing.sm },
  errorText: { color: colors.danger, fontSize: 14, lineHeight: 20 },
  noticeText: { color: colors.success, fontSize: 14, lineHeight: 20 },
});
