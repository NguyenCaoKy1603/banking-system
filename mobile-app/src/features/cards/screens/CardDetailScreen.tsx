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
import { TextField } from "@/components/ui/TextField";
import { useAuth } from "@/features/auth/context/AuthContext";
import { createOtpChallenge } from "@/features/auth/services/otpApi";
import { formatVndMinor } from "@/features/banking/presentation/formatMoney";
import {
  getCreditCardStatusLabel,
  getCreditStatementStatusLabel,
} from "@/features/credit/presentation/creditPresentation";
import {
  getCreditCard,
  lockCreditCard,
  reportCreditCardLost,
  unlockCreditCard,
} from "@/features/credit/services/creditApi";
import type {
  CreditCardDetailResponse,
  CreditCardStatus,
} from "@/features/credit/types/credit";
import { ApiError } from "@/services/api/ApiError";
import { colors, radius, shadows, sizes, spacing, typography } from "@/theme";

function getErrorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "Không thể tải chi tiết thẻ. Vui lòng thử lại.";
}

function getStatusTone(status: CreditCardStatus): "success" | "warning" | "danger" | "neutral" {
  if (status === "ACTIVE") return "success";
  if (status === "LOCKED") return "warning";
  if (status === "BLOCKED") return "danger";
  return "neutral";
}

function SummaryRow({
  label,
  value,
  dark = false,
  emphasize = false,
}: {
  label: string;
  value: string;
  dark?: boolean;
  emphasize?: boolean;
}) {
  return (
    <View style={styles.summaryRow}>
      <Text style={[styles.label, dark ? styles.darkLabel : null]}>{label}</Text>
      <Text
        style={[
          styles.value,
          dark ? styles.darkValue : null,
          emphasize ? styles.emphasizedValue : null,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

export function CardDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ cardId?: string }>();
  const cardId = typeof params.cardId === "string" ? params.cardId : "";
  const { deviceId, refreshAccessToken, session } = useAuth();
  const accessToken = session?.accessToken ?? null;
  const auth = useMemo(
    () => ({ accessToken, deviceId, refreshAccessToken }),
    [accessToken, deviceId, refreshAccessToken],
  );
  const [detail, setDetail] = useState<CreditCardDetailResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [stepUpProof, setStepUpProof] = useState("");
  const [controlChallengeId, setControlChallengeId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"UNLOCK" | "REPORT_LOST" | null>(null);
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

  useFocusEffect(
    useCallback(() => {
      void loadCard();
    }, [loadCard]),
  );

  const handleToggleLock = useCallback(async () => {
    const card = detail?.card;
    if (!card || isSaving) return;
    setIsSaving(true);
    setError(undefined);
    setNotice(undefined);
    try {
      if (card.status === "ACTIVE") {
        const response = await lockCreditCard(card.cardId, auth);
        setDetail((current) => (current ? { ...current, card: response.card } : current));
        setControlChallengeId(null);
        setPendingAction(null);
        setStepUpProof("");
        setNotice("Thẻ đã được khóa khẩn cấp.");
      } else if (card.status === "LOCKED") {
        if (!controlChallengeId || pendingAction !== "UNLOCK") {
          const challenge = await createOtpChallenge(
            { purpose: "CARD_UNLOCK", resourceId: card.cardId },
            auth,
          );
          setControlChallengeId(challenge.challengeId);
          setPendingAction("UNLOCK");
          setStepUpProof("");
          setNotice("Yêu cầu xác thực đã sẵn sàng. Hoàn tất bước bên dưới để mở khóa thẻ.");
          return;
        }
        const proof = stepUpProof.trim();
        if (!proof) {
          setError("Cần nhập mã TOTP từ ứng dụng xác thực.");
          return;
        }
        const stepUp = {
          method: "TOTP",
          proof,
          challengeId: controlChallengeId,
        } as const;
        const response = await unlockCreditCard(card.cardId, stepUp, auth);
        setDetail((current) => (current ? { ...current, card: response.card } : current));
        setStepUpProof("");
        setControlChallengeId(null);
        setPendingAction(null);
        setNotice("Thẻ đã được mở khóa sau khi xác thực.");
      } else {
        setError("Trạng thái hiện tại không cho phép khóa hoặc mở khóa thẻ.");
      }
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsSaving(false);
    }
  }, [auth, controlChallengeId, detail, isSaving, pendingAction, stepUpProof]);

  const handleReportLost = useCallback(async () => {
    const card = detail?.card;
    if (!card || isSaving) return;
    if (card.status !== "ACTIVE" && card.status !== "LOCKED") {
      setError("Chỉ thẻ đang hoạt động hoặc đang khóa mới có thể báo mất.");
      return;
    }
    setIsSaving(true);
    setError(undefined);
    setNotice(undefined);
    try {
      if (!controlChallengeId || pendingAction !== "REPORT_LOST") {
        const challenge = await createOtpChallenge(
          { purpose: "CARD_REPORT_LOST", resourceId: card.cardId },
          auth,
        );
        setControlChallengeId(challenge.challengeId);
        setPendingAction("REPORT_LOST");
        setStepUpProof("");
        setNotice("Nhập mã TOTP để xác nhận báo mất và chặn thẻ.");
        return;
      }
      const proof = stepUpProof.trim();
      if (!proof) {
        setError("Cần nhập mã TOTP từ ứng dụng xác thực.");
        return;
      }
      const response = await reportCreditCardLost(
        card.cardId,
        { method: "TOTP", proof, challengeId: controlChallengeId },
        auth,
      );
      setDetail((current) => (current ? { ...current, card: response.card } : current));
      setStepUpProof("");
      setControlChallengeId(null);
      setPendingAction(null);
      setNotice(`Thẻ đã bị chặn và hồ sơ vận hành ${response.caseId.slice(0, 8)} đã được tạo.`);
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsSaving(false);
    }
  }, [auth, controlChallengeId, detail, isSaving, pendingAction, stepUpProof]);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <AppHeader
          backTestID="card-detail-back"
          eyebrow="Quản lý thẻ"
          onBack={() => router.back()}
          subtitle="Theo dõi dư nợ, sao kê và kiểm soát trạng thái thẻ."
          title="Chi tiết thẻ"
        />
        <EnvironmentBadge />

        {isLoading ? (
          <StateCard loading message="Đang tải chi tiết thẻ..." testID="credit-card-detail-loading" />
        ) : error && !detail ? (
          <StateCard
            actionLabel="Thử lại"
            icon="alert"
            message={error}
            onAction={loadCard}
            testID="credit-card-detail-error"
            title="Không thể tải thẻ"
          />
        ) : detail ? (
          <>
            <View style={styles.heroCard} testID="credit-card-detail">
              <View style={styles.heroTop}>
                <View style={styles.brandRow}>
                  <View style={styles.brandIcon}>
                    <AppIcon color={colors.onPrimary} name="card" size={19} />
                  </View>
                  <Text style={styles.novaLabel}>NOVA</Text>
                </View>
                <Text style={styles.networkLabel}>{detail.card.brand}</Text>
              </View>
              <View style={styles.heroIdentity}>
                <Text style={styles.heroTitle}>{detail.card.displayName}</Text>
                <Text style={styles.heroMeta}>•••• •••• •••• {detail.card.lastFour}</Text>
              </View>
              <View style={styles.heroBottom}>
                <View>
                  <Text style={styles.heroCaption}>Hiệu lực đến</Text>
                  <Text style={styles.heroExpiry}>
                    {String(detail.card.expiryMonth).padStart(2, "0")}/
                    {String(detail.card.expiryYear).slice(-2)}
                  </Text>
                </View>
                <StatusBadge
                  label={getCreditCardStatusLabel(detail.card.status)}
                  tone={getStatusTone(detail.card.status)}
                />
              </View>
            </View>

            <Card elevated>
              <Text style={styles.sectionTitle}>Tổng quan hạn mức</Text>
              <View style={styles.highlightBalance}>
                <Text style={styles.highlightLabel}>Hạn mức khả dụng</Text>
                <Text style={styles.highlightValue}>
                  {formatVndMinor(detail.card.availableCredit.amountMinor)}
                </Text>
              </View>
              <SummaryRow label="Tổng hạn mức" value={formatVndMinor(detail.card.creditLimit.amountMinor)} />
              <SummaryRow
                emphasize
                label="Dư nợ đã ghi nhận"
                value={formatVndMinor(detail.card.postedOutstanding.amountMinor)}
              />
              <SummaryRow label="Giao dịch đang chờ" value={formatVndMinor(detail.card.pendingAuthorizations.amountMinor)} />
            </Card>

            <Card elevated>
              <View style={styles.sectionHeaderRow}>
                <View style={styles.sectionIcon}>
                  <AppIcon color={colors.primary} name="history" size={19} />
                </View>
                <Text style={styles.sectionTitle}>Sao kê gần nhất</Text>
              </View>
              {detail.latestStatement ? (
                <>
                  <SummaryRow
                    label="Trạng thái"
                    value={getCreditStatementStatusLabel(detail.latestStatement.status)}
                  />
                  <SummaryRow
                    label="Hạn thanh toán"
                    value={new Date(detail.latestStatement.dueAt).toLocaleDateString("vi-VN")}
                  />
                  <SummaryRow
                    emphasize
                    label="Còn phải trả"
                    value={formatVndMinor(detail.latestStatement.remainingAmountDue.amountMinor)}
                  />
                  <SummaryRow
                    label="Thanh toán tối thiểu"
                    value={formatVndMinor(detail.latestStatement.minimumPaymentRemaining.amountMinor)}
                  />
                </>
              ) : (
                <Text style={styles.mutedText}>Chưa có sao kê cho kỳ hiện tại.</Text>
              )}
            </Card>

            {controlChallengeId && pendingAction ? (
              <Card elevated>
                <View style={styles.sectionHeaderRow}>
                  <View style={styles.sectionIcon}>
                    <AppIcon color={colors.primary} name="shield" size={19} />
                  </View>
                  <View style={styles.sectionCopy}>
                    <Text style={styles.sectionTitle}>
                      {pendingAction === "UNLOCK" ? "Xác thực mở khóa" : "Xác nhận báo mất thẻ"}
                    </Text>
                    <Text style={styles.mutedText}>Nhập mã TOTP từ ứng dụng xác thực để tiếp tục.</Text>
                  </View>
                </View>
                <TextField
                  accessibilityLabel="Mã TOTP kiểm soát thẻ"
                  keyboardType="number-pad"
                  label="Mã từ ứng dụng xác thực"
                  onChangeText={setStepUpProof}
                  secureTextEntry
                  testID={pendingAction === "UNLOCK" ? "credit-unlock-code" : "credit-report-lost-code"}
                  value={stepUpProof}
                />
              </Card>
            ) : null}

            {error ? (
              <View style={styles.errorBox}>
                <AppIcon color={colors.danger} name="alert" size={18} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}
            {notice ? (
              <View style={styles.noticeBox}>
                <AppIcon color={colors.success} name="check" size={18} />
                <Text style={styles.noticeText}>{notice}</Text>
              </View>
            ) : null}

            <Button
              disabled={
                isSaving ||
                (detail.card.status !== "ACTIVE" && detail.card.status !== "LOCKED")
              }
              icon="lock"
              label={
                detail.card.status === "ACTIVE"
                  ? "Khóa thẻ"
                  : detail.card.status === "LOCKED"
                    ? pendingAction === "UNLOCK" && controlChallengeId
                      ? "Xác nhận mở khóa bằng TOTP"
                      : "Mở khóa thẻ"
                    : "Không thể thao tác"
              }
              loading={isSaving}
              onPress={() => void handleToggleLock()}
              testID="card-toggle-lock"
              variant={detail.card.status === "ACTIVE" ? "danger" : "primary"}
            />
            <Button
              disabled={isSaving || (detail.card.status !== "ACTIVE" && detail.card.status !== "LOCKED")}
              icon="alert"
              label={pendingAction === "REPORT_LOST" && controlChallengeId ? "Xác nhận báo mất thẻ" : "Báo mất thẻ"}
              loading={isSaving && pendingAction === "REPORT_LOST"}
              onPress={() => void handleReportLost()}
              testID="card-report-lost"
              variant="danger"
            />

            <Card>
              <Text style={styles.sectionTitle}>Dịch vụ thẻ</Text>
              <View style={styles.actionGrid}>
                <Button
                  icon="history"
                  label="Giao dịch thẻ"
                  onPress={() =>
                    router.push({
                      pathname: "/cards/[cardId]/transactions",
                      params: { cardId: detail.card.cardId },
                    })
                  }
                  testID="credit-open-transactions"
                  variant="outline"
                />
                <Button
                  icon="card"
                  label="Sao kê"
                  onPress={() =>
                    router.push({
                      pathname: "/cards/[cardId]/statements",
                      params: { cardId: detail.card.cardId },
                    })
                  }
                  testID="credit-open-statements"
                  variant="outline"
                />
                <Button
                  icon="transfer"
                  label="Thanh toán thẻ"
                  onPress={() =>
                    router.push({
                      pathname: "/cards/[cardId]/pay",
                      params: { cardId: detail.card.cardId },
                    })
                  }
                  testID="credit-open-payment"
                />
              </View>
            </Card>

            <View style={styles.securityNote}>
              <AppIcon color={colors.info} name="shield" size={18} />
              <Text style={styles.securityText}>
                Ứng dụng không hiển thị số thẻ đầy đủ, CVV hoặc PIN.
              </Text>
            </View>
          </>
        ) : (
          <StateCard icon="card" message="Không tìm thấy thẻ trong phiên hiện tại." title="Không có dữ liệu" />
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
    minHeight: 220,
    justifyContent: "space-between",
    gap: spacing.md,
    padding: spacing.mlg,
    borderRadius: radius.xl,
    backgroundColor: colors.navy,
    ...shadows.card,
  },
  heroTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  brandIcon: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.primary,
  },
  novaLabel: { ...typography.label, color: colors.onPrimary, letterSpacing: 1.2 },
  networkLabel: { ...typography.subheading, color: colors.onPrimary, fontStyle: "italic" },
  heroIdentity: { gap: spacing.sm },
  heroTitle: { ...typography.bodyStrong, color: "rgba(255,255,255,0.72)" },
  heroMeta: { ...typography.heading, color: colors.onPrimary, letterSpacing: 2 },
  heroBottom: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  heroCaption: { ...typography.caption, color: "rgba(255,255,255,0.62)" },
  heroExpiry: { ...typography.bodyStrong, color: colors.onPrimary },
  sectionHeaderRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  sectionIcon: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
  },
  sectionCopy: { flex: 1, gap: 2 },
  sectionTitle: { ...typography.subheading, color: colors.text },
  highlightBalance: {
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  highlightLabel: { ...typography.caption, color: colors.primary },
  highlightValue: { ...typography.heading, color: colors.primary },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  label: { ...typography.body, color: colors.muted },
  value: { flex: 1, ...typography.bodyStrong, color: colors.text, textAlign: "right" },
  darkLabel: { color: "rgba(255,255,255,0.78)" },
  darkValue: { color: colors.onPrimary },
  emphasizedValue: { color: colors.primary },
  mutedText: { ...typography.body, color: colors.muted },
  methodRow: { flexDirection: "row", gap: spacing.sm },
  methodButton: {
    minHeight: 52,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  methodSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  methodLabel: { ...typography.label, color: colors.primary },
  actionGrid: { gap: spacing.sm },
  errorBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
  },
  errorText: { flex: 1, ...typography.body, color: colors.danger },
  noticeBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.successSoft,
  },
  noticeText: { flex: 1, ...typography.body, color: colors.success },
  securityNote: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.md,
  },
  securityText: { ...typography.caption, color: colors.info, textAlign: "center" },
});
