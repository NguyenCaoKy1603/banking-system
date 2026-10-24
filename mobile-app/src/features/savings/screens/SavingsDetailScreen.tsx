import { useCallback, useMemo, useState } from "react";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

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
import type { AuthChallengeResponse } from "@/features/auth/types/auth";
import { formatVndMinor } from "@/features/banking/presentation/formatMoney";
import { createIdempotencyKey } from "@/features/banking/validation/idempotencyKey";
import {
  formatSavingsRate,
  getMaturityInstructionLabel,
  getSavingsDepositStatusLabel,
} from "@/features/savings/presentation/savingsPresentation";
import {
  getSavingsDeposit,
  updateSavingsDepositMaturityInstruction,
  withdrawSavingsDeposit,
} from "@/features/savings/services/savingsApi";
import type {
  MaturityInstruction,
  SavingsDeposit,
  SavingsWithdrawalReceipt,
} from "@/features/savings/types/savings";
import { ApiError } from "@/services/api/ApiError";
import { colors, radius, shadows, sizes, spacing, typography } from "@/theme";

function getErrorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "Không thể thực hiện yêu cầu. Vui lòng thử lại.";
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("vi-VN");
}

const INSTRUCTION_OPTIONS: {
  value: MaturityInstruction;
  label: string;
  description: string;
}[] = [
  {
    value: "RETURN_PRINCIPAL_AND_INTEREST",
    label: "Trả gốc và lãi về tài khoản",
    description: "Tất toán toàn bộ gốc và lãi vào tài khoản thanh toán khi đáo hạn.",
  },
  {
    value: "RENEW_PRINCIPAL",
    label: "Tái tục gốc, trả lãi về tài khoản",
    description: "Tiền gốc tiếp tục gửi kỳ hạn mới, lãi chuyển về tài khoản thanh toán.",
  },
  {
    value: "RENEW_PRINCIPAL_AND_INTEREST",
    label: "Tái tục cả gốc và lãi",
    description: "Nhập lãi vào gốc để tái tục sang kỳ hạn mới với giá trị cao hơn.",
  },
];

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

  // State: Thay đổi phương án đáo hạn
  const [isEditingInstruction, setIsEditingInstruction] = useState(false);
  const [selectedInstruction, setSelectedInstruction] = useState<MaturityInstruction>(
    "RETURN_PRINCIPAL_AND_INTEREST",
  );
  const [isUpdatingInstruction, setIsUpdatingInstruction] = useState(false);

  // State: Tất toán trước hạn
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [withdrawChallenge, setWithdrawChallenge] = useState<AuthChallengeResponse | null>(null);
  const [withdrawTotp, setWithdrawTotp] = useState("");
  const [isSubmittingWithdraw, setIsSubmittingWithdraw] = useState(false);
  const [withdrawalReceipt, setWithdrawalReceipt] = useState<SavingsWithdrawalReceipt | null>(null);

  // Thông báo hành động
  const [actionError, setActionError] = useState<string | undefined>();
  const [actionSuccess, setActionSuccess] = useState<string | undefined>();

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
      const result = await getSavingsDeposit(depositId, auth);
      setDeposit(result);
      setSelectedInstruction(result.maturityInstruction);
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

  const handleStartEditInstruction = useCallback(() => {
    if (!deposit) return;
    setSelectedInstruction(deposit.maturityInstruction);
    setIsEditingInstruction(true);
    setIsWithdrawing(false);
    setActionError(undefined);
    setActionSuccess(undefined);
  }, [deposit]);

  const handleSaveInstruction = useCallback(async () => {
    if (!deposit) return;
    setIsUpdatingInstruction(true);
    setActionError(undefined);
    setActionSuccess(undefined);
    try {
      const updated = await updateSavingsDepositMaturityInstruction(
        deposit.depositId,
        selectedInstruction,
        auth,
      );
      setDeposit(updated);
      setIsEditingInstruction(false);
      setActionSuccess("Đã cập nhật phương án khi đáo hạn thành công.");
    } catch (err: unknown) {
      setActionError(getErrorMessage(err));
    } finally {
      setIsUpdatingInstruction(false);
    }
  }, [auth, deposit, selectedInstruction]);

  const handleStartWithdraw = useCallback(async () => {
    if (!deposit) return;
    setIsWithdrawing(true);
    setIsEditingInstruction(false);
    setActionError(undefined);
    setActionSuccess(undefined);
    setWithdrawTotp("");
    try {
      const challenge = await createOtpChallenge(
        { purpose: "SAVINGS_WITHDRAWAL", resourceId: deposit.depositId },
        auth,
      );
      setWithdrawChallenge(challenge);
    } catch (err: unknown) {
      setActionError(getErrorMessage(err));
    }
  }, [auth, deposit]);

  const handleConfirmWithdraw = useCallback(async () => {
    if (!deposit || !withdrawChallenge) return;
    Keyboard.dismiss();
    const proof = withdrawTotp.trim();
    if (!/^\d{6}$/.test(proof)) {
      setActionError("Vui lòng nhập đúng 6 chữ số mã xác thực Google Authenticator.");
      return;
    }
    setIsSubmittingWithdraw(true);
    setActionError(undefined);
    try {
      const receipt = await withdrawSavingsDeposit(
        deposit.depositId,
        {
          stepUp: {
            method: "TOTP",
            proof,
            challengeId: withdrawChallenge.challengeId,
          },
        },
        {
          auth,
          idempotencyKey: createIdempotencyKey("savings-wth"),
        },
      );
      setWithdrawalReceipt(receipt);
      setDeposit((prev) => (prev ? { ...prev, status: "CLOSED" } : null));
      setIsWithdrawing(false);
      setActionSuccess("Tất toán trước hạn thành công! Tiền và lãi không kỳ hạn đã được chuyển về tài khoản.");
    } catch (err: unknown) {
      setActionError(getErrorMessage(err));
    } finally {
      setIsSubmittingWithdraw(false);
    }
  }, [auth, deposit, withdrawChallenge, withdrawTotp]);

  const isDepositActive = deposit?.status === "ACTIVE";

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

        {actionSuccess ? (
          <View style={styles.successBanner} testID="savings-detail-success-banner">
            <AppIcon color={colors.success} name="check" size={20} />
            <Text style={styles.successText}>{actionSuccess}</Text>
          </View>
        ) : null}

        {actionError ? (
          <View style={styles.errorBanner} testID="savings-detail-error-banner">
            <AppIcon color={colors.danger} name="alert" size={20} />
            <Text style={styles.errorText}>{actionError}</Text>
          </View>
        ) : null}

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

            {/* Biên lai nếu vừa tất toán thành công */}
            {withdrawalReceipt ? (
              <Card elevated testID="savings-withdrawal-receipt-card">
                <View style={styles.sectionHeader}>
                  <View style={[styles.sectionIcon, { backgroundColor: colors.successSoft }]}>
                    <AppIcon color={colors.success} name="check" size={19} />
                  </View>
                  <Text style={styles.cardTitle}>Biên lai tất toán trước hạn</Text>
                </View>
                <View style={styles.highlight}>
                  <Text style={styles.highlightLabel}>Tổng tiền nhận về tài khoản</Text>
                  <Text style={styles.highlightValue}>
                    {formatVndMinor(withdrawalReceipt.totalPayout.amountMinor)}
                  </Text>
                  <Text style={styles.highlightMeta}>
                    Bao gồm lãi không kỳ hạn: {formatVndMinor(withdrawalReceipt.earlyInterest.amountMinor)} (0.20%/năm, {withdrawalReceipt.interestDays} ngày thực gửi)
                  </Text>
                </View>
                <SummaryRow label="Tiền gốc hoàn trả" value={formatVndMinor(withdrawalReceipt.principal.amountMinor)} />
                <SummaryRow label="Mã giao dịch" value={withdrawalReceipt.reference} />
                <SummaryRow label="Thời gian tất toán" value={formatDate(withdrawalReceipt.withdrawnAt)} />
              </Card>
            ) : null}

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

            {/* Card form: Thay đổi phương án đáo hạn */}
            {isEditingInstruction && isDepositActive ? (
              <Card elevated testID="savings-edit-instruction-card">
                <Text style={styles.cardTitle}>Chọn phương án khi đáo hạn</Text>
                <Text style={styles.instructionPrompt}>
                  Khoản tiền gửi sẽ áp dụng phương án mới khi tới ngày đáo hạn:
                </Text>
                <View style={styles.optionsList}>
                  {INSTRUCTION_OPTIONS.map((option) => {
                    const isSelected = selectedInstruction === option.value;
                    return (
                      <Pressable
                        key={option.value}
                        onPress={() => setSelectedInstruction(option.value)}
                        style={[styles.optionCard, isSelected ? styles.optionCardSelected : null]}
                        testID={`instruction-option-${option.value}`}
                      >
                        <View style={styles.optionHeader}>
                          <View style={[styles.radioCircle, isSelected ? styles.radioCircleSelected : null]}>
                            {isSelected ? <View style={styles.radioDot} /> : null}
                          </View>
                          <Text style={[styles.optionLabel, isSelected ? styles.optionLabelSelected : null]}>
                            {option.label}
                          </Text>
                        </View>
                        <Text style={styles.optionDescription}>{option.description}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <View style={styles.buttonRow}>
                  <Button
                    disabled={isUpdatingInstruction}
                    label="Hủy"
                    onPress={() => setIsEditingInstruction(false)}
                    testID="savings-detail-cancel-instruction-button"
                    variant="ghost"
                  />
                  <Button
                    label="Xác nhận đổi"
                    loading={isUpdatingInstruction}
                    onPress={handleSaveInstruction}
                    testID="savings-detail-confirm-instruction-button"
                  />
                </View>
              </Card>
            ) : null}

            {/* Card form: Tất toán trước hạn */}
            {isWithdrawing && isDepositActive ? (
              <Card elevated testID="savings-withdraw-card">
                <View style={styles.sectionHeader}>
                  <View style={[styles.sectionIcon, { backgroundColor: colors.dangerSoft }]}>
                    <AppIcon color={colors.danger} name="alert" size={19} />
                  </View>
                  <Text style={[styles.cardTitle, { color: colors.danger }]}>Tất toán trước hạn</Text>
                </View>

                <View style={styles.warningBox}>
                  <Text style={styles.warningTitle}>Quy định lãi suất rút trước hạn</Text>
                  <Text style={styles.warningText}>
                    Theo quy định NHNN, khi tất toán trước hạn, toàn bộ tiền gửi sẽ chỉ được hưởng lãi suất không kỳ hạn (0.20%/năm) tính theo số ngày thực gửi thay vì mức lãi có kỳ hạn ban đầu ({formatSavingsRate(deposit.annualRateBasisPoints)}).
                  </Text>
                  <Text style={styles.warningText}>
                    Tiền gốc và lãi không kỳ hạn sẽ được chuyển ngay vào tài khoản thanh toán nguồn ({deposit.sourceAccountMaskedNumber}).
                  </Text>
                </View>

                <TextField
                  helperText="Mã xác thực 6 chữ số từ ứng dụng Google Authenticator."
                  keyboardType="number-pad"
                  label="Mã xác thực TOTP"
                  maxLength={6}
                  onChangeText={setWithdrawTotp}
                  placeholder="123456"
                  testID="savings-detail-withdraw-totp-input"
                  value={withdrawTotp}
                />

                <View style={styles.buttonRow}>
                  <Button
                    disabled={isSubmittingWithdraw}
                    label="Hủy"
                    onPress={() => setIsWithdrawing(false)}
                    testID="savings-detail-cancel-withdraw-button"
                    variant="ghost"
                  />
                  <Button
                    disabled={withdrawTotp.trim().length !== 6}
                    label="Xác nhận tất toán"
                    loading={isSubmittingWithdraw}
                    onPress={handleConfirmWithdraw}
                    testID="savings-detail-confirm-withdraw-button"
                    variant="danger"
                  />
                </View>
              </Card>
            ) : null}

            {/* Quản lý các nút tác vụ khi sổ đang ACTIVE */}
            {isDepositActive && !isEditingInstruction && !isWithdrawing ? (
              <Card testID="savings-actions-card">
                <Text style={styles.cardTitle}>Tùy chọn khoản gửi</Text>
                <View style={styles.actionsStack}>
                  <Button
                    icon="savings"
                    label="Đổi phương án đáo hạn"
                    onPress={handleStartEditInstruction}
                    testID="savings-detail-change-instruction-button"
                    variant="outline"
                  />
                  <Button
                    icon="alert"
                    label="Tất toán trước hạn"
                    onPress={handleStartWithdraw}
                    testID="savings-detail-withdraw-button"
                    variant="danger"
                  />
                </View>
              </Card>
            ) : null}

            <Card>
              <Text style={styles.cardTitle}>Thông tin khoản gửi</Text>
              <SummaryRow label="Sản phẩm" value={deposit.productName} />
              <SummaryRow label="Tài khoản nguồn" value={deposit.sourceAccountMaskedNumber} />
              <SummaryRow label="Mã tham chiếu" value={deposit.reference} />
              {deposit.earlyWithdrawnAt ? (
                <SummaryRow label="Ngày tất toán" value={formatDate(deposit.earlyWithdrawnAt)} />
              ) : null}
              {deposit.earlyInterest ? (
                <SummaryRow label="Lãi thực nhận" value={formatVndMinor(deposit.earlyInterest.amountMinor)} />
              ) : null}
            </Card>

            {!isDepositActive ? (
              <View style={[styles.noticeCard, { backgroundColor: colors.surfaceMuted }]}>
                <AppIcon color={colors.muted} name="check" size={20} />
                <View style={styles.noticeCopy}>
                  <Text style={styles.noticeTitle}>Trạng thái sổ tiết kiệm</Text>
                  <Text style={styles.noticeText}>
                    Khoản tiết kiệm này đã {deposit.status === "CLOSED" ? "được tất toán / đóng" : "đáo hạn"}. Tiền đã chuyển về tài khoản thanh toán nguồn.
                  </Text>
                </View>
              </View>
            ) : null}

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
  successBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.successSoft,
    borderWidth: 1,
    borderColor: colors.success,
  },
  successText: {
    flex: 1,
    ...typography.bodyStrong,
    color: colors.success,
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  errorText: {
    flex: 1,
    ...typography.bodyStrong,
    color: colors.danger,
  },
  instructionPrompt: {
    ...typography.body,
    color: colors.muted,
  },
  optionsList: {
    gap: spacing.sm,
    marginVertical: spacing.sm,
  },
  optionCard: {
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing.xs,
  },
  optionCardSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  optionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  radioCircleSelected: {
    borderColor: colors.primary,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },
  optionLabel: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  optionLabelSelected: {
    color: colors.primary,
  },
  optionDescription: {
    ...typography.caption,
    color: colors.muted,
    marginLeft: 28,
  },
  buttonRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  warningBox: {
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: "rgba(220, 38, 38, 0.2)",
  },
  warningTitle: {
    ...typography.label,
    color: colors.danger,
  },
  warningText: {
    ...typography.caption,
    color: colors.danger,
    lineHeight: 18,
  },
  actionsStack: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
});
