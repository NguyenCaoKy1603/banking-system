import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { AppHeader } from "@/components/ui/AppHeader";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { Screen } from "@/components/ui/Screen";
import { TextField } from "@/components/ui/TextField";
import { useAuth } from "@/features/auth/context/AuthContext";
import type { AuthChallengeResponse } from "@/features/auth/types/auth";
import { createOtpChallenge } from "@/features/auth/services/otpApi";
import { listAccounts } from "@/features/accounts/services/accountsApi";
import type { PaymentAccount } from "@/features/accounts/types/account";
import { formatVndMinor } from "@/features/banking/presentation/formatMoney";
import type { ClientIntentPhase } from "@/features/banking/domain/clientIntentLifecycle";
import {
  requiresManualReview,
  shouldKeepSubmitUnknown,
  type ManualReviewCode,
} from "@/features/banking/domain/submitFailure";
import { createIdempotencyKey as createBankingIdempotencyKey } from "@/features/banking/validation/idempotencyKey";
import { formatCreditDate, getCreditPaymentOptionLabel, getCreditPaymentStatusLabel } from "@/features/credit/presentation/creditPresentation";
import { getCreditCard, getCreditPayment, getCreditStatement, quoteCreditPayment, submitCreditPayment } from "@/features/credit/services/creditApi";
import { clearCardPaymentIntent, loadCardPaymentIntent, saveCardPaymentIntent } from "@/features/credit/storage/cardPaymentIntentStorage";
import type { CreditCardDetailResponse, CreditPayment, CreditPaymentOption, CreditPaymentQuote, CreditStatement, CreditStepUpMethod } from "@/features/credit/types/credit";
import { ApiError } from "@/services/api/ApiError";
import { getDeviceBoundAssertion, requestBiometricAuthentication } from "@/services/security/biometricAuth";
import { colors, radius, shadows, sizes, spacing, typography } from "@/theme";

type PaymentStep = "input" | "review" | "stepUp" | "result";
function getErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "Không thể thực hiện thanh toán thẻ.";
  const messages: Record<string, string> = {
    CREDIT_DISABLED: "Dịch vụ thanh toán thẻ đang tạm dừng.",
    CREDIT_ACCOUNT_NOT_FOUND: "Không tìm thấy tài khoản tín dụng. Vui lòng quay về danh sách thẻ.",
    STATEMENT_NOT_FOUND: "Không tìm thấy sao kê. Vui lòng tải lại danh sách sao kê.",
    STATEMENT_PAID: "Sao kê này đã được thanh toán đủ.",
    STATEMENT_CHANGED: "Sao kê đã thay đổi. Vui lòng kiểm tra lại số tiền.",
    STATEMENT_SUPERSEDED: "Sao kê đã được thay thế. Vui lòng tải lại kỳ hiện hành.",
    PAYMENT_PENDING: "Đã có một thanh toán đang xử lý. Vui lòng cập nhật trạng thái trước khi tạo lệnh mới.",
    QUOTE_EXPIRED: "Thông tin thanh toán đã hết hạn. Vui lòng tạo lại.",
    PAYMENT_AMOUNT_INVALID: "Số tiền thanh toán không hợp lệ.",
    OVERPAYMENT: "Số tiền vượt quá dư nợ còn phải trả.",
    INSUFFICIENT_FUNDS: "Tài khoản nguồn không đủ số dư. Vui lòng chọn tài khoản hoặc số tiền khác.",
    SOURCE_ACCOUNT_BLOCKED: "Tài khoản nguồn không hoạt động. Vui lòng chọn tài khoản khác.",
    IDEMPOTENCY_CONFLICT: "Nội dung yêu cầu đã thay đổi. Vui lòng quay lại và tạo yêu cầu mới.",
    STEP_UP_VERIFICATION_FAILED: "Xác thực không thành công. Vui lòng tạo mã mới và thử lại.",
    STEP_UP_INVALID: "Xác thực bước hai không hợp lệ. Vui lòng xác thực lại.",
    RATE_LIMITED: "Bạn thao tác quá nhiều lần. Vui lòng thử lại sau.",
    TIMEOUT: "Chưa nhận được kết quả. Hãy giữ nguyên yêu cầu và cập nhật trạng thái.",
    NETWORK_ERROR: "Không thể kết nối. Yêu cầu được giữ lại để bạn thử lại an toàn.",
  };
  return messages[error.code] ?? error.message;
}

const MANUAL_REVIEW_MESSAGE =
  "Yêu cầu này cần được đối soát thủ công. Không gửi lại, chỉnh sửa hoặc tạo challenge mới; vui lòng liên hệ hỗ trợ.";

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
  const [recoveryPaymentId, setRecoveryPaymentId] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [intentPhase, setIntentPhase] = useState<ClientIntentPhase | null>(null);
  const [manualReviewCode, setManualReviewCode] =
    useState<ManualReviewCode | null>(null);
  const [stepUpMethod, setStepUpMethod] = useState<CreditStepUpMethod>("OTP");
  const [stepUpProof, setStepUpProof] = useState("");
  const [paymentChallenge, setPaymentChallenge] =
    useState<AuthChallengeResponse | null>(null);
  const [step, setStep] = useState<PaymentStep>("input");
  const [isLoading, setIsLoading] = useState(true);
  const [isRestoring, setIsRestoring] = useState(true);
  const [recoveryBlocked, setRecoveryBlocked] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [clockMs, setClockMs] = useState(() => Date.now());
  const submitLockRef = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => setClockMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const applyPaymentChallenge = useCallback(
    (challenge: AuthChallengeResponse) => {
      if (challenge.purpose && challenge.purpose !== "CREDIT_PAYMENT") {
        throw new Error("Máy chủ trả challenge không đúng mục đích thanh toán.");
      }
      setPaymentChallenge(challenge);
      setStepUpMethod((currentMethod) =>
        challenge.methods.includes(currentMethod)
          ? currentMethod
          : challenge.methods.find(
              (method): method is CreditStepUpMethod =>
                method === "OTP" || method === "TOTP" || method === "BIOMETRIC",
            ) ?? "OTP",
      );
      setStepUpProof("");
    },
    [],
  );

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
    if (!userId || !cardId) { setIsRestoring(false); return; }
    setIsRestoring(true);
    try {
      const intent = await loadCardPaymentIntent(userId, cardId);
      if (!intent) {
        setRecoveryBlocked(false);
        return;
      }
      setRecoveryBlocked(false);
      setQuote(intent.quote); setIdempotencyKey(intent.idempotencyKey); setIntentPhase(intent.phase); setManualReviewCode(intent.manualReviewCode ?? null); setSourceAccountId(intent.quote.sourceAccountId); setPaymentOption(intent.quote.paymentOption);
      if (intent.paymentId) {
        setRecoveryPaymentId(intent.paymentId);
        setPayment(intent.payment ?? null); setStep("result");
        const latest = await getCreditPayment(intent.paymentId, auth);
        setPayment(latest);
        const latestPhase = latest.status === "PENDING" ? "ACCEPTED_PENDING" : "ACCEPTED_TERMINAL";
        setIntentPhase(latestPhase);
        setManualReviewCode(null);
        await saveCardPaymentIntent({ phase: latestPhase, submitAttempted: true, userId, cardId, creditAccountId: intent.creditAccountId, statementId: intent.statementId, idempotencyKey: intent.idempotencyKey, quote: intent.quote, createdAt: intent.createdAt, paymentId: latest.paymentId, payment: latest });
      } else {
        setStep("stepUp");
        if (intent.manualReviewCode) {
          setPaymentChallenge(null);
          setStepUpProof("");
          setError(MANUAL_REVIEW_MESSAGE);
          return;
        }
        const challenge = await createOtpChallenge(
          { purpose: "CREDIT_PAYMENT", resourceId: intent.quote.quoteId },
          auth,
        );
        applyPaymentChallenge(challenge);
      }
    } catch (requestError: unknown) {
      setRecoveryBlocked(true);
      setError(getErrorMessage(requestError));
    }
    finally { setIsRestoring(false); }
  }, [applyPaymentChallenge, auth, cardId, userId]);

  useEffect(() => { void Promise.resolve().then(() => restoreIntent()); }, [restoreIntent]);

  const handleQuote = useCallback(async () => {
    if (recoveryBlocked) {
      setError("Chưa xác định an toàn yêu cầu trước đó. Hãy kiểm tra lại dữ liệu khôi phục.");
      return;
    }
    if (!detail || !statement || !sourceAccountId || isSubmitting) return;
    if (!userId) {
      setError("Phiên đăng nhập không còn hợp lệ.");
      return;
    }
    setIsSubmitting(true); setError(undefined);
    try {
      const nextQuote = await quoteCreditPayment({ sourceAccountId, creditAccountId: detail.creditAccount.creditAccountId, statementId: statement.statementId, paymentOption, ...(paymentOption === "CUSTOM" ? { amount: { currency: "VND", amountMinor: customAmount.replace(/\D/g, "") } } : {}) }, auth);
      const nextKey =
        idempotencyKey ?? createBankingIdempotencyKey("credit-payment");
      setQuote(nextQuote); setPaymentChallenge(null); setIdempotencyKey(nextKey); setManualReviewCode(null); setStep("review");
      await saveCardPaymentIntent({ phase: "DRAFT_QUOTE", submitAttempted: false, userId, cardId, creditAccountId: detail.creditAccount.creditAccountId, statementId: statement.statementId, idempotencyKey: nextKey, quote: nextQuote, createdAt: Date.now() });
      setIntentPhase("DRAFT_QUOTE");
    } catch (requestError: unknown) {
      const code = getApiErrorCode(requestError);
      setError(getErrorMessage(requestError));
      if (code === "CREDIT_ACCOUNT_NOT_FOUND") {
        await clearCardPaymentIntent(userId, cardId).catch(() => undefined);
        router.replace("/cards");
      } else if (["STATEMENT_CHANGED", "STATEMENT_PAID", "STATEMENT_NOT_FOUND", "STATEMENT_SUPERSEDED", "PAYMENT_PENDING", "OVERPAYMENT"].includes(code ?? "")) {
        setQuote(null);
        setIdempotencyKey(null);
        setIntentPhase(null);
        setManualReviewCode(null);
        setPaymentChallenge(null);
        setStepUpProof("");
        setStep("input");
        await clearCardPaymentIntent(userId, cardId);
        await loadData();
      }
    }
    finally { setIsSubmitting(false); }
  }, [auth, cardId, customAmount, detail, idempotencyKey, isSubmitting, loadData, paymentOption, recoveryBlocked, router, sourceAccountId, statement, userId]);

  const handleContinueToStepUp = useCallback(async () => {
    if (recoveryBlocked) {
      setError("Chưa xác định an toàn yêu cầu trước đó. Hãy kiểm tra lại dữ liệu khôi phục.");
      return;
    }
    if (!quote || submitLockRef.current) return;
    if (manualReviewCode) {
      setError(MANUAL_REVIEW_MESSAGE);
      return;
    }
    if (intentPhase !== "SUBMIT_UNKNOWN" && Date.now() >= Date.parse(quote.expiresAt)) {
      setError("Quote đã hết hạn. Vui lòng tạo lại quote.");
      return;
    }
    submitLockRef.current = true; setIsSubmitting(true); setError(undefined);
    try {
      const challenge = await createOtpChallenge(
        { purpose: "CREDIT_PAYMENT", resourceId: quote.quoteId },
        auth,
      );
      applyPaymentChallenge(challenge);
      setStep("stepUp");
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError));
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  }, [applyPaymentChallenge, auth, intentPhase, manualReviewCode, quote, recoveryBlocked]);

  const handleSubmit = useCallback(async () => {
    if (recoveryBlocked) {
      setError("Chưa xác định an toàn yêu cầu trước đó. Hãy kiểm tra lại dữ liệu khôi phục.");
      return;
    }
    if (submitLockRef.current || !quote || !idempotencyKey || !userId) return;
    if (manualReviewCode) {
      setError(MANUAL_REVIEW_MESSAGE);
      return;
    }
    if (intentPhase !== "SUBMIT_UNKNOWN" && Date.now() >= Date.parse(quote.expiresAt)) {
      setError("Quote đã hết hạn. Vui lòng tạo lại quote.");
      return;
    }
    if (!paymentChallenge || clockMs >= Date.parse(paymentChallenge.expiresAt)) {
      setError("Challenge xác thực đã hết hạn. Vui lòng tạo challenge mới.");
      return;
    }
    if (!paymentChallenge.methods.includes(stepUpMethod)) {
      setError("Phương thức xác thực không được challenge hiện tại cho phép.");
      return;
    }
    submitLockRef.current = true;
    setIsSubmitting(true); setError(undefined);
    let requestStarted = false;
    try {
      let proof = stepUpProof.trim();
      if (stepUpMethod === "BIOMETRIC") { await requestBiometricAuthentication("Xác thực thanh toán thẻ"); proof = getDeviceBoundAssertion(); }
      if (!proof) { setError("Cần nhập mã xác thực hoặc hoàn tất phương thức được hỗ trợ."); return; }
      await saveCardPaymentIntent({ phase: "SUBMIT_UNKNOWN", submitAttempted: true, userId, cardId, creditAccountId: quote.creditAccountId, statementId: quote.statementId, idempotencyKey, quote, createdAt: Date.now() });
      setIntentPhase("SUBMIT_UNKNOWN");
      requestStarted = true;
      const nextPayment = await submitCreditPayment({ quoteId: quote.quoteId, stepUp: { method: stepUpMethod, proof, challengeId: paymentChallenge.challengeId } }, { auth, idempotencyKey });
      setPayment(nextPayment); setStep("result");
      setRecoveryPaymentId(nextPayment.paymentId);
      const acceptedPhase = nextPayment.status === "PENDING" ? "ACCEPTED_PENDING" : "ACCEPTED_TERMINAL";
      await saveCardPaymentIntent({ phase: acceptedPhase, submitAttempted: true, userId, cardId, creditAccountId: quote.creditAccountId, statementId: quote.statementId, idempotencyKey, quote, createdAt: Date.now(), paymentId: nextPayment.paymentId, payment: nextPayment }).catch(() => undefined);
      setIntentPhase(acceptedPhase);
      setManualReviewCode(null);
    } catch (requestError: unknown) {
      const code = getApiErrorCode(requestError);
      setError(getErrorMessage(requestError));
      if (requestStarted && code === "CREDIT_ACCOUNT_NOT_FOUND") {
        await clearCardPaymentIntent(userId, cardId).catch(() => undefined);
        setPaymentChallenge(null);
        setStepUpProof("");
        router.replace("/cards");
      } else if (requestStarted && ["QUOTE_EXPIRED", "NOT_FOUND", "STATEMENT_CHANGED", "STATEMENT_PAID", "STATEMENT_NOT_FOUND", "STATEMENT_SUPERSEDED", "PAYMENT_PENDING", "OVERPAYMENT", "PAYMENT_AMOUNT_INVALID", "INSUFFICIENT_FUNDS", "SOURCE_ACCOUNT_BLOCKED"].includes(code ?? "")) {
        setQuote(null);
        setRecoveryPaymentId(null);
        setIdempotencyKey(null);
        setIntentPhase(null);
        setManualReviewCode(null);
        setStep("input");
        setPaymentChallenge(null);
        setStepUpProof("");
        await clearCardPaymentIntent(userId, cardId);
        await loadData();
      } else if (requestStarted && requiresManualReview(requestError)) {
        await saveCardPaymentIntent({ phase: "SUBMIT_UNKNOWN", submitAttempted: true, userId, cardId, creditAccountId: quote.creditAccountId, statementId: quote.statementId, idempotencyKey, quote, createdAt: Date.now(), manualReviewCode: requestError.code }).catch(() => undefined);
        setManualReviewCode(requestError.code);
        setPaymentChallenge(null);
        setStepUpProof("");
        setError(MANUAL_REVIEW_MESSAGE);
      } else if (requestStarted && !shouldKeepSubmitUnknown(requestError)) {
        await saveCardPaymentIntent({ phase: "DRAFT_QUOTE", submitAttempted: false, userId, cardId, creditAccountId: quote.creditAccountId, statementId: quote.statementId, idempotencyKey, quote, createdAt: Date.now() }).catch(() => undefined);
        setIntentPhase("DRAFT_QUOTE");
        setManualReviewCode(null);
        setPaymentChallenge(null);
        setStepUpProof("");
        setStep("stepUp");
      }
    }
    finally { submitLockRef.current = false; setIsSubmitting(false); }
  }, [auth, cardId, clockMs, idempotencyKey, intentPhase, loadData, manualReviewCode, paymentChallenge, quote, recoveryBlocked, router, stepUpMethod, stepUpProof, userId]);

  const handleEditQuote = useCallback(() => {
    if (manualReviewCode) {
      setError(MANUAL_REVIEW_MESSAGE);
      setStep("stepUp");
      return;
    }
    if (intentPhase === "SUBMIT_UNKNOWN") {
      setError("Yêu cầu trước chưa xác định kết quả. Vui lòng thử lại với cùng khóa yêu cầu.");
      setStep("stepUp");
      return;
    }
    setQuote(null);
    setRecoveryPaymentId(null);
    setIdempotencyKey(null);
    setIntentPhase(null);
    setManualReviewCode(null);
    setPaymentChallenge(null);
    setStepUpProof("");
    setStep("input");
    if (userId && cardId) {
      void clearCardPaymentIntent(userId, cardId).catch(() => undefined);
    }
  }, [cardId, intentPhase, manualReviewCode, userId]);

  const handleRenewPaymentChallenge = useCallback(async () => {
    if (!quote || submitLockRef.current || manualReviewCode || recoveryBlocked) {
      if (manualReviewCode) setError(MANUAL_REVIEW_MESSAGE);
      return;
    }
    submitLockRef.current = true;
    setIsSubmitting(true); setError(undefined);
    try {
      const challenge = await createOtpChallenge(
        { purpose: "CREDIT_PAYMENT", resourceId: quote.quoteId },
        auth,
      );
      applyPaymentChallenge(challenge);
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError));
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  }, [applyPaymentChallenge, auth, manualReviewCode, quote, recoveryBlocked]);

  const handleRefreshPayment = useCallback(async () => {
    if (submitLockRef.current) return;
    const paymentId = payment?.paymentId ?? recoveryPaymentId;
    if (!paymentId) return;
    submitLockRef.current = true;
    setIsSubmitting(true); setError(undefined);
    try {
      const latest = await getCreditPayment(paymentId, auth);
      setPayment(latest);
      setRecoveryPaymentId(latest.paymentId);
      const latestPhase = latest.status === "PENDING" ? "ACCEPTED_PENDING" : "ACCEPTED_TERMINAL";
      setIntentPhase(latestPhase);
      if (userId && quote && idempotencyKey) {
        await saveCardPaymentIntent({ phase: latestPhase, submitAttempted: true, userId, cardId, creditAccountId: quote.creditAccountId, statementId: quote.statementId, idempotencyKey, quote, createdAt: Date.now(), paymentId: latest.paymentId, payment: latest });
      }
    }
    catch (requestError: unknown) { setError(getErrorMessage(requestError)); }
    finally { submitLockRef.current = false; setIsSubmitting(false); }
  }, [auth, cardId, idempotencyKey, payment, quote, recoveryPaymentId, userId]);

  const handleBack = useCallback(async () => {
    if (isSubmitting || submitLockRef.current) return;
    if (intentPhase === "ACCEPTED_TERMINAL" && userId && cardId) {
      await clearCardPaymentIntent(userId, cardId).catch(() => undefined);
    }
    router.back();
  }, [cardId, intentPhase, isSubmitting, router, userId]);

  const handlePaymentDone = useCallback(async () => {
    if (isSubmitting || submitLockRef.current) return;
    if (intentPhase === "ACCEPTED_TERMINAL" && userId && cardId) {
      await clearCardPaymentIntent(userId, cardId).catch(() => undefined);
    }
    router.replace({ pathname: "/cards/[cardId]", params: { cardId } });
  }, [cardId, intentPhase, isSubmitting, router, userId]);

  const canPay = statement && statement.remainingAmountDue.amountMinor !== "0";
  const isPaymentChallengeUnavailable =
    !paymentChallenge || clockMs >= Date.parse(paymentChallenge.expiresAt);
  return <Screen><ScrollView contentContainerStyle={styles.content}>
    <AppHeader backTestID="credit-payment-back" eyebrow="Quản lý dư nợ" onBack={() => void handleBack()} subtitle="Chọn nguồn tiền và xác thực để thanh toán sao kê an toàn." title="Thanh toán thẻ" />
    {isLoading || isRestoring ? <View style={styles.centerState} testID="credit-payment-loading"><Text style={styles.mutedText}>Đang tải dữ liệu thanh toán…</Text></View> : recoveryBlocked ? <View style={styles.card} testID="credit-recovery-blocked"><Text style={styles.sectionTitle}>Chưa thể khôi phục an toàn</Text><Text style={styles.errorText}>{error ?? "Không thể đọc trạng thái yêu cầu trước đó. Chưa cho phép tạo thanh toán mới để tránh trùng lệnh."}</Text><PrimaryButton label="Kiểm tra lại dữ liệu khôi phục" onPress={() => { setError(undefined); void restoreIntent(); }} testID="credit-recovery-retry" /></View> : error && !detail ? <View style={styles.card}><Text style={styles.errorText}>{error}</Text><PrimaryButton label="Thử lại" onPress={loadData} /></View> : !detail || !statement ? <View style={styles.card}><Text style={styles.mutedText}>Không có sao kê cần thanh toán.</Text></View> : !canPay && step !== "result" ? <View style={styles.card}><Text style={styles.mutedText}>Sao kê này đã được thanh toán đủ.</Text></View> : <>
      {step === "input" ? <View style={styles.card} testID="credit-payment-input"><Text style={styles.sectionTitle}>Chọn tài khoản nguồn</Text>{accounts.map((account) => <Pressable accessibilityRole="button" accessibilityState={{ selected: sourceAccountId === account.id }} key={account.id} onPress={() => setSourceAccountId(account.id)} style={[styles.optionRow, sourceAccountId === account.id ? styles.optionSelected : null]} testID={`credit-source-${account.id}`}><View><Text style={styles.optionTitle}>{account.displayName}</Text><Text style={styles.optionMeta}>{account.maskedNumber} · Khả dụng {formatVndMinor(account.availableBalance.amountMinor)}</Text></View><Text style={styles.radio}>{sourceAccountId === account.id ? "●" : "○"}</Text></Pressable>)}<Text style={styles.sectionTitle}>Mức thanh toán</Text><View style={styles.choiceRow}>{(["MINIMUM", "FULL_STATEMENT", "CUSTOM"] as CreditPaymentOption[]).map((option) => <Pressable accessibilityRole="button" accessibilityState={{ selected: paymentOption === option }} key={option} onPress={() => setPaymentOption(option)} style={[styles.choice, paymentOption === option ? styles.choiceSelected : null]} testID={`credit-option-${option}`}><Text style={styles.choiceLabel}>{getCreditPaymentOptionLabel(option)}</Text></Pressable>)}</View>{paymentOption === "CUSTOM" ? <TextField keyboardType="number-pad" label="Số tiền (VND)" onChangeText={(value) => setCustomAmount(value.replace(/\D/g, ""))} testID="credit-custom-amount" value={customAmount} /> : null}<PrimaryButton disabled={isSubmitting || !sourceAccountId} label={isSubmitting ? "Đang tính quote…" : "Xem lại thanh toán"} onPress={() => void handleQuote()} testID="credit-create-quote" /></View> : null}
      {step === "review" && quote ? <View style={styles.card} testID="credit-payment-review"><Text style={styles.sectionTitle}>Xác nhận quote</Text><SummaryRow label="Mức thanh toán" value={getCreditPaymentOptionLabel(quote.paymentOption)} /><SummaryRow label="Nguồn tiền" value={quote.sourceAccountMaskedNumber} /><SummaryRow label="Thẻ" value={`•••• ${quote.cardLastFour}`} /><SummaryRow label="Kỳ sao kê" value={`${formatCreditDate(statement.cycleStartAt)} – ${formatCreditDate(statement.cycleEndAt)}`} /><SummaryRow label="Số tiền" value={formatVndMinor(quote.amount.amountMinor)} /><SummaryRow label="Dư nợ dự kiến còn lại" value={formatVndMinor(quote.outstandingAfter.amountMinor)} /><SummaryRow label="Tối thiểu còn thiếu" value={formatVndMinor(quote.minimumPaymentRemainingAfter.amountMinor)} /><SummaryRow label="Phí" value={formatVndMinor(quote.fee.amountMinor)} /><SummaryRow label="Quote hết hạn" value={new Date(quote.expiresAt).toLocaleString("vi-VN")} /><Text style={styles.noticeText}>{quote.terms}</Text><PrimaryButton disabled={isSubmitting || Boolean(manualReviewCode)} label={manualReviewCode ? "Đang chờ đối soát" : "Tiếp tục xác thực"} onPress={() => void handleContinueToStepUp()} testID="credit-review-confirm" /><PrimaryButton disabled={Boolean(manualReviewCode)} label={manualReviewCode ? "Đang chờ đối soát" : "Chỉnh sửa"} onPress={handleEditQuote} testID="credit-review-edit" /></View> : null}
      {step === "stepUp" && quote ? <View style={styles.card} testID="credit-payment-step-up"><Text style={styles.sectionTitle}>Xác thực thanh toán</Text><View style={styles.choiceRow}>{paymentChallenge?.methods.some((method) => method === "OTP" || method === "TOTP") ? <Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(manualReviewCode), selected: stepUpMethod === "OTP" || stepUpMethod === "TOTP" }} disabled={Boolean(manualReviewCode)} onPress={() => setStepUpMethod(paymentChallenge.methods.includes("TOTP") ? "TOTP" : "OTP")} style={[styles.choice, stepUpMethod === "OTP" || stepUpMethod === "TOTP" ? styles.choiceSelected : null]} testID="credit-step-up-otp"><Text style={styles.choiceLabel}>{stepUpMethod === "TOTP" ? "Mã TOTP" : "Mã xác thực"}</Text></Pressable> : null}{paymentChallenge?.methods.includes("BIOMETRIC") ? <Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(manualReviewCode), selected: stepUpMethod === "BIOMETRIC" }} disabled={Boolean(manualReviewCode)} onPress={() => setStepUpMethod("BIOMETRIC")} style={[styles.choice, stepUpMethod === "BIOMETRIC" ? styles.choiceSelected : null]} testID="credit-step-up-biometric"><Text style={styles.choiceLabel}>Sinh trắc học</Text></Pressable> : null}</View>{stepUpMethod === "OTP" || stepUpMethod === "TOTP" ? <TextField accessibilityLabel="Mã xác thực thanh toán thẻ" editable={!manualReviewCode} keyboardType="number-pad" label={stepUpMethod === "TOTP" ? "Mã TOTP" : "Mã xác thực"} onChangeText={setStepUpProof} secureTextEntry testID="credit-step-up-code" value={stepUpProof} /> : <Text style={styles.mutedText}>Thiết bị sẽ yêu cầu phương thức xác thực được hỗ trợ.</Text>}{manualReviewCode ? <Text style={styles.errorText}>Mã đối soát: {manualReviewCode}</Text> : null}{isPaymentChallengeUnavailable ? <PrimaryButton disabled={isSubmitting || Boolean(manualReviewCode)} label={manualReviewCode ? "Đang chờ đối soát" : isSubmitting ? "Đang tạo lại…" : "Tạo challenge mới"} onPress={() => void handleRenewPaymentChallenge()} testID="credit-step-up-renew" /> : null}<PrimaryButton disabled={isSubmitting || Boolean(manualReviewCode) || isPaymentChallengeUnavailable} label={manualReviewCode ? "Không thể gửi lại" : isSubmitting ? "Đang thanh toán…" : isPaymentChallengeUnavailable ? "Challenge đã hết hạn" : "Thanh toán"} onPress={() => void handleSubmit()} testID="credit-submit-payment" /><PrimaryButton disabled={Boolean(manualReviewCode)} label={manualReviewCode ? "Đang chờ đối soát" : "Quay lại review"} onPress={() => setStep("review")} testID="credit-step-up-back" /></View> : null}
      {step === "result" && (payment || recoveryPaymentId) ? <View style={styles.card} testID="credit-payment-result"><Text style={styles.sectionTitle}>{payment ? getCreditPaymentStatusLabel(payment.status) : "Đang khôi phục trạng thái thanh toán"}</Text>{payment ? <><SummaryRow label="Số tiền" value={formatVndMinor(payment.amount.amountMinor)} /><SummaryRow label="Mã tham chiếu" value={payment.reference} /></> : null}<Text style={styles.mutedText}>{!payment || payment.status === "PENDING" ? "Có thể làm mới để tiếp tục trạng thái sau timeout/restart." : "Số dư và sao kê sẽ được tải lại từ server khi quay về chi tiết thẻ."}</Text>{!payment || payment.status === "PENDING" ? <PrimaryButton disabled={isSubmitting} label="Cập nhật trạng thái" onPress={() => void handleRefreshPayment()} testID="credit-payment-refresh" /> : null}<PrimaryButton disabled={isSubmitting} label="Về chi tiết thẻ" onPress={handlePaymentDone} testID="credit-payment-done" /></View> : null}
    </>}
    {error && detail ? <Text style={styles.errorText}>{error}</Text> : null}
  </ScrollView></Screen>;
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, width: "100%", maxWidth: sizes.contentMaxWidth, alignSelf: "center", padding: spacing.lg, gap: spacing.lg },
  centerState: { minHeight: 220, alignItems: "center", justifyContent: "center" },
  card: { gap: spacing.md, padding: spacing.mlg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, ...shadows.card },
  sectionTitle: { ...typography.subheading, color: colors.text },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  label: { ...typography.body, color: colors.muted },
  value: { flex: 1, ...typography.bodyStrong, color: colors.text, textAlign: "right" },
  optionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  optionSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  optionTitle: { ...typography.bodyStrong, color: colors.text },
  optionMeta: { ...typography.caption, color: colors.muted, marginTop: 4 },
  radio: { color: colors.primary, fontSize: 20 },
  choiceRow: { flexDirection: "row", gap: spacing.sm },
  choice: { minHeight: 44, flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm },
  choiceSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  choiceLabel: { ...typography.label, color: colors.primary, textAlign: "center" },
  mutedText: { ...typography.body, color: colors.muted },
  noticeText: { ...typography.caption, color: colors.primary },
  errorText: { ...typography.body, padding: spacing.md, borderRadius: radius.md, color: colors.danger, backgroundColor: colors.dangerSoft },
});
