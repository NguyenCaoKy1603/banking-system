import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { Screen } from "@/components/ui/Screen";
import { TextField } from "@/components/ui/TextField";
import { useAuth } from "@/features/auth/context/AuthContext";
import { createOtpChallenge } from "@/features/auth/services/otpApi";
import { listAccounts } from "@/features/accounts/services/accountsApi";
import type { PaymentAccount } from "@/features/accounts/types/account";
import { formatVndMinor } from "@/features/banking/presentation/formatMoney";
import { formatCreditDate, getCreditPaymentOptionLabel, getCreditPaymentStatusLabel } from "@/features/credit/presentation/creditPresentation";
import { getCreditCard, getCreditPayment, getCreditStatement, quoteCreditPayment, submitCreditPayment } from "@/features/credit/services/creditApi";
import { clearCardPaymentIntent, loadCardPaymentIntent, saveCardPaymentIntent } from "@/features/credit/storage/cardPaymentIntentStorage";
import type { CreditCardDetailResponse, CreditPayment, CreditPaymentOption, CreditPaymentQuote, CreditStatement, CreditStepUpMethod } from "@/features/credit/types/credit";
import { ApiError } from "@/services/api/ApiError";
import { getSandboxBiometricProof, requestBiometricAuthentication } from "@/services/security/biometricAuth";
import { colors, spacing } from "@/theme";

type PaymentStep = "input" | "review" | "stepUp" | "result";
function createIdempotencyKey(): string { return `credit-payment-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; }
function getErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "Không thể thực hiện thanh toán thẻ.";
  const messages: Record<string, string> = {
    CREDIT_DISABLED: "Thanh toán tín dụng sandbox đang tạm dừng.",
    CREDIT_ACCOUNT_NOT_FOUND: "Không tìm thấy tài khoản tín dụng. Vui lòng quay về danh sách thẻ.",
    STATEMENT_NOT_FOUND: "Không tìm thấy sao kê. Vui lòng tải lại danh sách sao kê.",
    STATEMENT_PAID: "Sao kê này đã được thanh toán đủ.",
    STATEMENT_CHANGED: "Sao kê đã thay đổi. Vui lòng tạo lại quote.",
    QUOTE_EXPIRED: "Quote đã hết hạn. Vui lòng tạo lại quote.",
    PAYMENT_AMOUNT_INVALID: "Số tiền thanh toán không hợp lệ.",
    OVERPAYMENT: "Số tiền vượt quá dư nợ còn phải trả.",
    INSUFFICIENT_FUNDS: "Tài khoản nguồn không đủ số dư. Vui lòng chọn tài khoản hoặc số tiền khác.",
    SOURCE_ACCOUNT_BLOCKED: "Tài khoản nguồn không hoạt động. Vui lòng chọn tài khoản khác.",
    IDEMPOTENCY_CONFLICT: "Yêu cầu này đã có khóa idempotency khác nội dung; không tạo ý định mới.",
    STEP_UP_INVALID: "Xác thực bước hai không hợp lệ. Vui lòng xác thực lại.",
    RATE_LIMITED: "Bạn thao tác quá nhiều lần. Vui lòng thử lại sau.",
    TIMEOUT: "Máy chủ chưa trả kết quả. Giữ nguyên yêu cầu để kiểm tra lại cùng khóa idempotency.",
    NETWORK_ERROR: "Không thể kết nối máy chủ. Giữ nguyên yêu cầu để thử lại an toàn.",
  };
  return messages[error.code] ?? error.message;
}

function getApiErrorCode(error: unknown): string | null {
  return error instanceof ApiError ? error.code : null;
}

function SummaryRow({ label, value }: { label: string; value: string }) { return <View style={styles.summaryRow}><Text style={styles.label}>{label}</Text><Text style={styles.value}>{value}</Text></View>; }

export function CreditPaymentScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ cardId?: string; statementId?: string }>();
  const cardId = typeof params.cardId === "string" ? params.cardId : "";
  const requestedStatementId = typeof params.statementId === "string" ? params.statementId : "";
  const { deviceId, refreshAccessToken, session } = useAuth();
  const accessToken = session?.accessToken ?? null;
  const userId = session?.user.id ?? null;
  const auth = useMemo(() => ({ accessToken, deviceId, refreshAccessToken }), [accessToken, deviceId, refreshAccessToken]);
  const [detail, setDetail] = useState<CreditCardDetailResponse | null>(null);
  const [statement, setStatement] = useState<CreditStatement | null>(null);
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [sourceAccountId, setSourceAccountId] = useState<string | null>(null);
  const [paymentOption, setPaymentOption] = useState<CreditPaymentOption>("MINIMUM");
  const [customAmount, setCustomAmount] = useState("");
  const [quote, setQuote] = useState<CreditPaymentQuote | null>(null);
  const [payment, setPayment] = useState<CreditPayment | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [stepUpMethod, setStepUpMethod] = useState<CreditStepUpMethod>("OTP");
  const [stepUpProof, setStepUpProof] = useState("");
  const [paymentChallengeId, setPaymentChallengeId] = useState<string | null>(null);
  const [step, setStep] = useState<PaymentStep>("input");
  const [isLoading, setIsLoading] = useState(true);
  const [isRestoring, setIsRestoring] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const loadData = useCallback(async () => {
    if (!accessToken || !cardId) { setIsLoading(false); return; }
    setIsLoading(true); setError(undefined);
    try {
      const [nextDetail, accountResponse] = await Promise.all([getCreditCard(cardId, auth), listAccounts(auth)]);
      setDetail(nextDetail);
      setAccounts(accountResponse.accounts);
      setSourceAccountId((current) => current && accountResponse.accounts.some((item) => item.id === current) ? current : accountResponse.accounts[0]?.id ?? null);
      let nextStatement = nextDetail.latestStatement;
      if (requestedStatementId && requestedStatementId !== nextStatement?.statementId) nextStatement = await getCreditStatement(nextDetail.creditAccount.creditAccountId, requestedStatementId, auth);
      setStatement(nextStatement);
    } catch (requestError: unknown) { setError(getErrorMessage(requestError)); }
    finally { setIsLoading(false); }
  }, [accessToken, auth, cardId, requestedStatementId]);

  useEffect(() => { void Promise.resolve().then(() => loadData()); }, [loadData]);

  const restoreIntent = useCallback(async () => {
    if (!userId) { setIsRestoring(false); return; }
    setIsRestoring(true);
    try {
      const intent = await loadCardPaymentIntent(userId);
      if (!intent || intent.cardId !== cardId) return;
      setQuote(intent.quote); setIdempotencyKey(intent.idempotencyKey); setSourceAccountId(intent.quote.sourceAccountId); setPaymentOption(intent.quote.paymentOption);
      const challenge = await createOtpChallenge(
        { purpose: "CREDIT_PAYMENT", resourceId: intent.quote.quoteId },
        auth,
      );
      setPaymentChallengeId(challenge.challengeId); setStep("stepUp");
      if (intent.paymentId) {
        const latest = await getCreditPayment(intent.paymentId, auth);
        setPayment(latest); setStep("result");
        if (latest.status !== "PENDING") await clearCardPaymentIntent();
      }
    } catch (requestError: unknown) { setError(getErrorMessage(requestError)); }
    finally { setIsRestoring(false); }
  }, [auth, cardId, userId]);

  useEffect(() => { void Promise.resolve().then(() => restoreIntent()); }, [restoreIntent]);

  const handleQuote = useCallback(async () => {
    if (!detail || !statement || !sourceAccountId || isSubmitting) return;
    setIsSubmitting(true); setError(undefined);
    try {
      const nextQuote = await quoteCreditPayment({ sourceAccountId, creditAccountId: detail.creditAccount.creditAccountId, statementId: statement.statementId, paymentOption, ...(paymentOption === "CUSTOM" ? { amount: { currency: "VND", amountMinor: customAmount.replace(/\D/g, "") } } : {}) }, auth);
      const nextKey = idempotencyKey ?? createIdempotencyKey();
      setQuote(nextQuote); setPaymentChallengeId(null); setIdempotencyKey(nextKey); setStep("review");
      if (userId) await saveCardPaymentIntent({ userId, cardId, creditAccountId: detail.creditAccount.creditAccountId, statementId: statement.statementId, idempotencyKey: nextKey, quote: nextQuote, createdAt: Date.now() });
    } catch (requestError: unknown) {
      const code = getApiErrorCode(requestError);
      setError(getErrorMessage(requestError));
      if (code === "CREDIT_ACCOUNT_NOT_FOUND") {
        router.replace("/cards");
      } else if (["STATEMENT_CHANGED", "STATEMENT_PAID", "STATEMENT_NOT_FOUND", "OVERPAYMENT"].includes(code ?? "")) {
        setQuote(null);
        setStep("input");
        await clearCardPaymentIntent();
        await loadData();
      }
    }
    finally { setIsSubmitting(false); }
  }, [auth, cardId, customAmount, detail, idempotencyKey, isSubmitting, loadData, paymentOption, router, sourceAccountId, statement, userId]);

  const handleContinueToStepUp = useCallback(async () => {
    if (!quote || isSubmitting) return;
    setIsSubmitting(true); setError(undefined);
    try {
      const challenge = await createOtpChallenge(
        { purpose: "CREDIT_PAYMENT", resourceId: quote.quoteId },
        auth,
      );
      setPaymentChallengeId(challenge.challengeId);
      setStepUpProof("");
      setStep("stepUp");
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsSubmitting(false);
    }
  }, [auth, isSubmitting, quote]);

  const handleSubmit = useCallback(async () => {
    if (!quote || !idempotencyKey || isSubmitting) return;
    setIsSubmitting(true); setError(undefined);
    try {
      let proof = stepUpProof.trim();
      if (stepUpMethod === "BIOMETRIC") { await requestBiometricAuthentication("Xác thực thanh toán thẻ sandbox"); proof = getSandboxBiometricProof(); }
      if (!proof) { setError("Cần nhập OTP sandbox hoặc hoàn tất sinh trắc học."); return; }
      const nextPayment = await submitCreditPayment({ quoteId: quote.quoteId, stepUp: { method: stepUpMethod, proof, challengeId: paymentChallengeId ?? undefined } }, { auth, idempotencyKey });
      setPayment(nextPayment); setStep("result");
      if (userId) await saveCardPaymentIntent({ userId, cardId, creditAccountId: quote.creditAccountId, statementId: quote.statementId, idempotencyKey, quote, createdAt: Date.now(), paymentId: nextPayment.paymentId, payment: nextPayment });
      if (nextPayment.status !== "PENDING") await clearCardPaymentIntent();
    } catch (requestError: unknown) {
      const code = getApiErrorCode(requestError);
      setError(getErrorMessage(requestError));
      if (code === "CREDIT_ACCOUNT_NOT_FOUND") {
        router.replace("/cards");
      } else if (["QUOTE_EXPIRED", "STATEMENT_CHANGED", "STATEMENT_PAID", "STATEMENT_NOT_FOUND", "OVERPAYMENT", "PAYMENT_AMOUNT_INVALID", "INSUFFICIENT_FUNDS", "SOURCE_ACCOUNT_BLOCKED"].includes(code ?? "")) {
        setQuote(null);
        setStep("input");
        setStepUpProof("");
        await clearCardPaymentIntent();
        await loadData();
      } else if (code === "STEP_UP_INVALID") {
        setStepUpProof("");
        setStep("stepUp");
      }
    }
    finally { setIsSubmitting(false); }
  }, [auth, cardId, idempotencyKey, isSubmitting, loadData, paymentChallengeId, quote, router, stepUpMethod, stepUpProof, userId]);

  const handleRefreshPayment = useCallback(async () => {
    if (!payment) return;
    setIsSubmitting(true); setError(undefined);
    try { const latest = await getCreditPayment(payment.paymentId, auth); setPayment(latest); if (latest.status !== "PENDING") await clearCardPaymentIntent(); }
    catch (requestError: unknown) { setError(getErrorMessage(requestError)); }
    finally { setIsSubmitting(false); }
  }, [auth, payment]);

  const canPay = statement && statement.remainingAmountDue.amountMinor !== "0";
  return <Screen><ScrollView contentContainerStyle={styles.content}>
    <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.backButton} testID="credit-payment-back"><Text style={styles.backLabel}>‹ Quay lại</Text></Pressable>
    <View style={styles.header}><Text style={styles.eyebrow}>M7 · PAYMENT</Text><Text style={styles.title}>Thanh toán thẻ</Text><Text style={styles.description}>Server tính quote, kiểm tra MFA, idempotency và trạng thái. Mobile không tự cập nhật số dư.</Text></View>
    {isLoading || isRestoring ? <View style={styles.centerState} testID="credit-payment-loading"><Text style={styles.mutedText}>Đang tải dữ liệu thanh toán…</Text></View> : error && !detail ? <View style={styles.card}><Text style={styles.errorText}>{error}</Text><PrimaryButton label="Thử lại" onPress={loadData} /></View> : !detail || !statement ? <View style={styles.card}><Text style={styles.mutedText}>Không có sao kê cần thanh toán.</Text></View> : !canPay && step !== "result" ? <View style={styles.card}><Text style={styles.mutedText}>Sao kê này đã được thanh toán đủ.</Text></View> : <>
      {step === "input" ? <View style={styles.card} testID="credit-payment-input"><Text style={styles.sectionTitle}>Chọn tài khoản nguồn</Text>{accounts.map((account) => <Pressable key={account.id} onPress={() => setSourceAccountId(account.id)} style={[styles.optionRow, sourceAccountId === account.id ? styles.optionSelected : null]} testID={`credit-source-${account.id}`}><View><Text style={styles.optionTitle}>{account.displayName}</Text><Text style={styles.optionMeta}>{account.maskedNumber} · Khả dụng {formatVndMinor(account.availableBalance.amountMinor)}</Text></View><Text style={styles.radio}>{sourceAccountId === account.id ? "●" : "○"}</Text></Pressable>)}<Text style={styles.sectionTitle}>Mức thanh toán</Text><View style={styles.choiceRow}>{(["MINIMUM", "FULL_STATEMENT", "CUSTOM"] as CreditPaymentOption[]).map((option) => <Pressable key={option} onPress={() => setPaymentOption(option)} style={[styles.choice, paymentOption === option ? styles.choiceSelected : null]} testID={`credit-option-${option}`}><Text style={styles.choiceLabel}>{getCreditPaymentOptionLabel(option)}</Text></Pressable>)}</View>{paymentOption === "CUSTOM" ? <TextField keyboardType="number-pad" label="Số tiền (VND)" onChangeText={(value) => setCustomAmount(value.replace(/\D/g, ""))} testID="credit-custom-amount" value={customAmount} /> : null}<PrimaryButton disabled={isSubmitting || !sourceAccountId} label={isSubmitting ? "Đang tính quote…" : "Xem lại thanh toán"} onPress={() => void handleQuote()} testID="credit-create-quote" /></View> : null}
      {step === "review" && quote ? <View style={styles.card} testID="credit-payment-review"><Text style={styles.sectionTitle}>Xác nhận quote</Text><SummaryRow label="Mức thanh toán" value={getCreditPaymentOptionLabel(quote.paymentOption)} /><SummaryRow label="Nguồn tiền" value={quote.sourceAccountMaskedNumber} /><SummaryRow label="Thẻ" value={`•••• ${quote.cardLastFour}`} /><SummaryRow label="Kỳ sao kê" value={`${formatCreditDate(statement.cycleStartAt)} – ${formatCreditDate(statement.cycleEndAt)}`} /><SummaryRow label="Số tiền" value={formatVndMinor(quote.amount.amountMinor)} /><SummaryRow label="Dư nợ dự kiến còn lại" value={formatVndMinor(quote.outstandingAfter.amountMinor)} /><SummaryRow label="Tối thiểu còn thiếu" value={formatVndMinor(quote.minimumPaymentRemainingAfter.amountMinor)} /><SummaryRow label="Phí" value={formatVndMinor(quote.fee.amountMinor)} /><SummaryRow label="Quote hết hạn" value={new Date(quote.expiresAt).toLocaleString("vi-VN")} /><Text style={styles.noticeText}>{quote.terms}</Text><PrimaryButton disabled={isSubmitting} label="Tiếp tục xác thực" onPress={() => void handleContinueToStepUp()} testID="credit-review-confirm" /><PrimaryButton label="Chỉnh sửa" onPress={() => setStep("input")} testID="credit-review-edit" /></View> : null}
      {step === "stepUp" && quote ? <View style={styles.card} testID="credit-payment-step-up"><Text style={styles.sectionTitle}>Xác thực thanh toán</Text><View style={styles.choiceRow}><Pressable onPress={() => setStepUpMethod("OTP")} style={[styles.choice, stepUpMethod === "OTP" ? styles.choiceSelected : null]} testID="credit-step-up-otp"><Text style={styles.choiceLabel}>OTP</Text></Pressable><Pressable onPress={() => setStepUpMethod("BIOMETRIC")} style={[styles.choice, stepUpMethod === "BIOMETRIC" ? styles.choiceSelected : null]} testID="credit-step-up-biometric"><Text style={styles.choiceLabel}>Sinh trắc học</Text></Pressable></View>{stepUpMethod === "OTP" ? <TextField accessibilityLabel="Mã xác thực thanh toán thẻ" keyboardType="number-pad" label="Mã OTP sandbox" onChangeText={setStepUpProof} secureTextEntry testID="credit-step-up-code" value={stepUpProof} /> : <Text style={styles.mutedText}>Thiết bị sẽ yêu cầu xác thực sinh trắc học.</Text>}<PrimaryButton disabled={isSubmitting} label={isSubmitting ? "Đang thanh toán…" : "Thanh toán"} onPress={() => void handleSubmit()} testID="credit-submit-payment" /><PrimaryButton label="Quay lại review" onPress={() => setStep("review")} testID="credit-step-up-back" /></View> : null}
      {step === "result" && payment ? <View style={styles.card} testID="credit-payment-result"><Text style={styles.sectionTitle}>{getCreditPaymentStatusLabel(payment.status)}</Text><SummaryRow label="Số tiền" value={formatVndMinor(payment.amount.amountMinor)} /><SummaryRow label="Mã tham chiếu" value={payment.reference} /><Text style={styles.mutedText}>{payment.status === "PENDING" ? "Có thể làm mới để tiếp tục trạng thái sau timeout/restart." : "Số dư và sao kê sẽ được tải lại từ server khi quay về chi tiết thẻ."}</Text>{payment.status === "PENDING" ? <PrimaryButton disabled={isSubmitting} label="Cập nhật trạng thái" onPress={() => void handleRefreshPayment()} testID="credit-payment-refresh" /> : null}<PrimaryButton label="Về chi tiết thẻ" onPress={() => router.replace({ pathname: "/cards/[cardId]", params: { cardId } })} testID="credit-payment-done" /></View> : null}
    </>}
    {error && detail ? <Text style={styles.errorText}>{error}</Text> : null}
  </ScrollView></Screen>;
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, width: "100%", maxWidth: 720, alignSelf: "center", padding: spacing.lg, gap: spacing.lg }, backButton: { alignSelf: "flex-start", paddingVertical: spacing.xs }, backLabel: { color: colors.primary, fontSize: 15, fontWeight: "600" }, header: { gap: spacing.sm }, eyebrow: { color: colors.primary, fontSize: 12, fontWeight: "700", letterSpacing: 1.4 }, title: { color: colors.text, fontSize: 30, fontWeight: "700" }, description: { color: colors.muted, fontSize: 15, lineHeight: 22 }, centerState: { minHeight: 220, alignItems: "center", justifyContent: "center" }, card: { gap: spacing.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: 20, backgroundColor: colors.surface }, sectionTitle: { color: colors.text, fontSize: 18, fontWeight: "800" }, summaryRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md }, label: { color: colors.muted, fontSize: 14 }, value: { flex: 1, color: colors.text, fontSize: 14, fontWeight: "800", textAlign: "right" }, optionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: 14 }, optionSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft }, optionTitle: { color: colors.text, fontSize: 15, fontWeight: "800" }, optionMeta: { color: colors.muted, fontSize: 13, marginTop: 4 }, radio: { color: colors.primary, fontSize: 20 }, choiceRow: { flexDirection: "row", gap: spacing.sm }, choice: { minHeight: 44, flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: 12 }, choiceSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft }, choiceLabel: { color: colors.primary, fontSize: 13, fontWeight: "700", textAlign: "center" }, mutedText: { color: colors.muted, fontSize: 14, lineHeight: 20 }, noticeText: { color: colors.primary, fontSize: 13, lineHeight: 19 }, errorText: { color: colors.danger, fontSize: 14, lineHeight: 20 },
});
