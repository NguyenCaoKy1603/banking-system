import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "expo-router";
import { ActivityIndicator, Keyboard, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { AppHeader } from "@/components/ui/AppHeader";
import { EnvironmentBadge } from "@/components/ui/EnvironmentBadge";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { Screen } from "@/components/ui/Screen";
import { TextField } from "@/components/ui/TextField";
import { listAccounts } from "@/features/accounts/services/accountsApi";
import type { PaymentAccount } from "@/features/accounts/types/account";
import { useAuth } from "@/features/auth/context/AuthContext";
import type { AuthChallengeResponse } from "@/features/auth/types/auth";
import { createOtpChallenge } from "@/features/auth/services/otpApi";
import { formatVndMinor } from "@/features/banking/presentation/formatMoney";
import type { ClientIntentPhase } from "@/features/banking/domain/clientIntentLifecycle";
import {
  requiresManualReview,
  shouldKeepSubmitUnknown,
  type ManualReviewCode,
} from "@/features/banking/domain/submitFailure";
import { createIdempotencyKey } from "@/features/banking/validation/idempotencyKey";
import { getControlPolicy } from "@/features/control/services/controlPolicyApi";
import type { ControlPolicy } from "@/features/control/types/controlPolicy";
import { getMaturityInstructionLabel, formatSavingsRate, getSavingsOpeningStatusLabel } from "@/features/savings/presentation/savingsPresentation";
import {
  getSavingsOpening,
  listSavingsProducts,
  quoteSavings,
  submitSavingsOpening,
} from "@/features/savings/services/savingsApi";
import {
  clearSavingsIntent,
  loadSavingsIntent,
  saveSavingsIntent,
} from "@/features/savings/storage/savingsIntentStorage";
import type {
  MaturityInstruction,
  SavingsOpening,
  SavingsProduct,
  SavingsQuote,
} from "@/features/savings/types/savings";
import { ApiError } from "@/services/api/ApiError";
import { TotpRequiredNotice } from "@/features/auth/components/TotpRequiredNotice";
import { useTotpStatus } from "@/features/auth/hooks/useTotpStatus";
import { isTotpNotEnrolledError, TOTP_NOT_ENROLLED_MESSAGE } from "@/features/auth/utils/totpError";
import { loadBiometricCredential } from "@/features/auth/storage/biometricCredentialStorage";
import {
  createDeviceBoundBiometricAssertion,
  getDeviceBoundAssertion,
  requestBiometricAuthentication,
} from "@/services/security/biometricAuth";
import { colors, radius, shadows, sizes, spacing, typography } from "@/theme";

type OpenSavingsStep = "input" | "review" | "stepUp" | "result";

function getErrorMessage(error: unknown): string {
  if (
    error instanceof ApiError &&
    error.code === "STEP_UP_VERIFICATION_FAILED"
  ) {
    return "Xác thực không thành công. Vui lòng tạo mã mới và thử lại.";
  }
  if (isTotpNotEnrolledError(error)) {
    return TOTP_NOT_ENROLLED_MESSAGE;
  }
  return error instanceof ApiError
    ? error.message
    : "Không thể thực hiện yêu cầu. Vui lòng thử lại.";
}

const MANUAL_REVIEW_MESSAGE =
  "Yêu cầu này cần được đối soát thủ công. Không gửi lại, chỉnh sửa hoặc tạo mã mới; vui lòng liên hệ hỗ trợ.";

function formatRemainingSeconds(value: number | null): string {
  if (value === null) {
    return "—";
  }
  if (value <= 0) {
    return "Đã hết hạn";
  }
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

const maturityInstructions: MaturityInstruction[] = [
  "RETURN_PRINCIPAL_AND_INTEREST",
  "RENEW_PRINCIPAL",
  "RENEW_PRINCIPAL_AND_INTEREST",
];

export function OpenSavingsScreen() {
  const router = useRouter();
  const { deviceId, refreshAccessToken, session } = useAuth();
  const { hasActiveTotp } = useTotpStatus();
  const accessToken = session?.accessToken ?? null;
  const userId = session?.user.id ?? null;
  const auth = useMemo(
    () => ({ accessToken, deviceId, refreshAccessToken }),
    [accessToken, deviceId, refreshAccessToken],
  );
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [products, setProducts] = useState<SavingsProduct[]>([]);
  const [controlPolicy, setControlPolicy] = useState<ControlPolicy | null>(null);
  const [sourceAccountId, setSourceAccountId] = useState<string | null>(null);
  const [productId, setProductId] = useState<string | null>(null);
  const [amountMinor, setAmountMinor] = useState("");
  const [maturityInstruction, setMaturityInstruction] = useState<MaturityInstruction>(
    "RETURN_PRINCIPAL_AND_INTEREST",
  );
  const [quote, setQuote] = useState<SavingsQuote | null>(null);
  const [opening, setOpening] = useState<SavingsOpening | null>(null);
  const [recoveryOpeningId, setRecoveryOpeningId] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [intentPhase, setIntentPhase] = useState<ClientIntentPhase | null>(null);
  const [manualReviewCode, setManualReviewCode] =
    useState<ManualReviewCode | null>(null);
  const [stepUpMethod, setStepUpMethod] = useState<"OTP" | "TOTP" | "BIOMETRIC">("TOTP");
  const [stepUpProof, setStepUpProof] = useState("");
  const [savingsChallenge, setSavingsChallenge] =
    useState<AuthChallengeResponse | null>(null);
  const [step, setStep] = useState<OpenSavingsStep>("input");
  const [isLoading, setIsLoading] = useState(true);
  const [isRestoringIntent, setIsRestoringIntent] = useState(true);
  const [recoveryBlocked, setRecoveryBlocked] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [clockMs, setClockMs] = useState(() => Date.now());
  const submitLockRef = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => setClockMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const applySavingsChallenge = useCallback(
    (challenge: AuthChallengeResponse) => {
      if (challenge.purpose && challenge.purpose !== "SAVINGS_OPENING") {
        throw new Error("Máy chủ trả challenge không đúng mục đích tiền gửi.");
      }
      setSavingsChallenge(challenge);
      setStepUpMethod((currentMethod) =>
        challenge.methods.includes("TOTP")
          ? "TOTP"
          : challenge.methods.includes(currentMethod)
            ? currentMethod
            : (challenge.methods[0] as "OTP" | "TOTP" | "BIOMETRIC") ?? "TOTP",
      );
      setStepUpProof("");
    },
    [],
  );

  const loadInitialData = useCallback(async () => {
    if (!accessToken) {
      setIsLoading(false);
      setError("Phiên đăng nhập không còn hợp lệ.");
      return;
    }
    setIsLoading(true);
    setError(undefined);
    try {
      const [accountResponse, productResponse, policyResponse] = await Promise.all([
        listAccounts(auth),
        listSavingsProducts(auth),
        getControlPolicy(auth),
      ]);
      setAccounts(accountResponse.accounts);
      setSourceAccountId((current) => current ?? accountResponse.accounts[0]?.id ?? null);
      setProducts(productResponse.items);
      setProductId((current) => current ?? productResponse.items[0]?.productId ?? null);
      setControlPolicy(policyResponse);
      setStepUpMethod((current) =>
        policyResponse.savingsStepUpMethods.includes("TOTP")
          ? "TOTP"
          : policyResponse.savingsStepUpMethods.includes(current)
            ? current
            : policyResponse.savingsStepUpMethods[0] ?? "TOTP",
      );
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsLoading(false);
    }
  }, [accessToken, auth]);

  useEffect(() => {
    void Promise.resolve().then(() => loadInitialData());
  }, [loadInitialData]);

  const restoreIntent = useCallback(async () => {
    if (!userId) {
      setIsRestoringIntent(false);
      return;
    }
    setIsRestoringIntent(true);
    try {
      const intent = await loadSavingsIntent(userId);
      if (!intent) {
        setRecoveryBlocked(false);
        return;
      }
      setRecoveryBlocked(false);
      setQuote(intent.quote);
      setSourceAccountId(intent.quote.sourceAccountId);
      setProductId(intent.quote.productId);
      setAmountMinor(intent.quote.principal.amountMinor);
      setMaturityInstruction(intent.quote.maturityInstruction);
      setIdempotencyKey(intent.idempotencyKey);
      setIntentPhase(intent.phase);
      setManualReviewCode(intent.manualReviewCode ?? null);
      if (intent.openingId) {
        setRecoveryOpeningId(intent.openingId);
        setOpening(intent.opening ?? null);
        setStep("result");
        const latestOpening = await getSavingsOpening(intent.openingId, auth);
        setOpening(latestOpening);
        const latestPhase =
          latestOpening.status === "PENDING"
            ? "ACCEPTED_PENDING"
            : "ACCEPTED_TERMINAL";
        setIntentPhase(latestPhase);
        setManualReviewCode(null);
        await saveSavingsIntent({
          phase: latestPhase,
          submitAttempted: true,
          userId,
          idempotencyKey: intent.idempotencyKey,
          quote: intent.quote,
          createdAt: intent.createdAt,
          openingId: latestOpening.openingId,
          opening: latestOpening,
        });
      } else {
        setStep("stepUp");
        if (intent.manualReviewCode) {
          setSavingsChallenge(null);
          setStepUpProof("");
          setError(MANUAL_REVIEW_MESSAGE);
          return;
        }
        const challenge = await createOtpChallenge(
          { purpose: "SAVINGS_OPENING", resourceId: intent.quote.quoteId },
          auth,
        );
        applySavingsChallenge(challenge);
      }
    } catch (requestError: unknown) {
      setRecoveryBlocked(true);
      setError(getErrorMessage(requestError));
    } finally {
      setIsRestoringIntent(false);
    }
  }, [applySavingsChallenge, auth, userId]);

  useEffect(() => {
    void Promise.resolve().then(() => restoreIntent());
  }, [restoreIntent]);

  const sourceAccount = accounts.find((account) => account.id === sourceAccountId) ?? null;
  const selectedProduct = products.find((product) => product.productId === productId) ?? null;
  const quoteRemainingSeconds = quote
    ? Math.max(0, Math.ceil((Date.parse(quote.expiresAt) - clockMs) / 1000))
    : null;
  const isQuoteExpired = quoteRemainingSeconds !== null && quoteRemainingSeconds <= 0;
  const challengeRemainingSeconds = savingsChallenge
    ? Math.max(
        0,
        Math.ceil((Date.parse(savingsChallenge.expiresAt) - clockMs) / 1000),
      )
    : null;
  const isSavingsChallengeUnavailable =
    challengeRemainingSeconds === null || challengeRemainingSeconds <= 0;
  const isAvailable = Boolean(
    controlPolicy &&
      !controlPolicy.globalKillSwitch &&
      controlPolicy.savingsEnabled &&
      controlPolicy.savingsAllowlisted,
  );

  const handleQuote = useCallback(async () => {
    if (recoveryBlocked) {
      setError("Chưa xác định an toàn yêu cầu trước đó. Hãy kiểm tra lại dữ liệu khôi phục.");
      return;
    }
    Keyboard.dismiss();
    if (!sourceAccountId || !selectedProduct) {
      setError("Vui lòng chọn tài khoản nguồn và kỳ hạn.");
      return;
    }
    if (!controlPolicy || !isAvailable) {
      setError("Tiền gửi đang tạm dừng theo chính sách server.");
      return;
    }
    const normalizedAmount = amountMinor.trim();
    if (!/^[1-9]\d*$/.test(normalizedAmount)) {
      setError("Số tiền gửi phải là số nguyên dương.");
      return;
    }
    const amount = BigInt(normalizedAmount);
    if (sourceAccount && amount > BigInt(sourceAccount.availableBalance.amountMinor)) {
      setError(
        `Số dư khả dụng không đủ (Hiện có: ${formatVndMinor(sourceAccount.availableBalance.amountMinor)}).`,
      );
      return;
    }
    if (
      amount < BigInt(selectedProduct.minAmountMinor) ||
      amount > BigInt(selectedProduct.maxAmountMinor) ||
      amount > BigInt(controlPolicy.maxSavingsAmountMinor)
    ) {
      setError("Số tiền nằm ngoài hạn mức của sản phẩm đã chọn.");
      return;
    }
    setIsSubmitting(true);
    setError(undefined);
    try {
      const response = await quoteSavings(
        {
          sourceAccountId,
          productId: selectedProduct.productId,
          principal: { currency: "VND", amountMinor: normalizedAmount },
          maturityInstruction,
        },
        auth,
      );
      setQuote(response);
      setOpening(null);
      setStep("review");
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsSubmitting(false);
    }
  }, [amountMinor, auth, controlPolicy, isAvailable, maturityInstruction, recoveryBlocked, selectedProduct, sourceAccount, sourceAccountId]);

  const handleConfirmReview = useCallback(async () => {
    if (recoveryBlocked) {
      setError("Chưa xác định an toàn yêu cầu trước đó. Hãy kiểm tra lại dữ liệu khôi phục.");
      return;
    }
    if (submitLockRef.current) {
      return;
    }

    if (!quote || !userId) {
      setError("Báo giá hoặc phiên đăng nhập không còn hợp lệ.");
      return;
    }
    if (isQuoteExpired) {
      setError("Báo giá đã hết hạn. Vui lòng tạo báo giá mới.");
      return;
    }
    submitLockRef.current = true;
    setIsSubmitting(true);
    setError(undefined);
    try {
      const nextKey = idempotencyKey ?? createIdempotencyKey("savings");
      await saveSavingsIntent({
        phase: "DRAFT_QUOTE",
        submitAttempted: false,
        userId,
        idempotencyKey: nextKey,
        quote,
        createdAt: Date.now(),
      });
      const challenge = await createOtpChallenge(
        { purpose: "SAVINGS_OPENING", resourceId: quote.quoteId },
        auth,
      );
      applySavingsChallenge(challenge);
      setIdempotencyKey(nextKey);
      setIntentPhase("DRAFT_QUOTE");
      setManualReviewCode(null);
      setStep("stepUp");
    } catch (storageError: unknown) {
      setError(getErrorMessage(storageError));
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  }, [applySavingsChallenge, auth, idempotencyKey, isQuoteExpired, quote, recoveryBlocked, userId]);

  const handleEditInput = useCallback(() => {
    if (manualReviewCode) {
      setError(MANUAL_REVIEW_MESSAGE);
      setStep("stepUp");
      return;
    }
    if (intentPhase === "SUBMIT_UNKNOWN") {
      setError(
        "Yêu cầu trước chưa xác định kết quả. Vui lòng thử lại với cùng khóa yêu cầu.",
      );
      setStep("stepUp");
      return;
    }
    setQuote(null);
    setOpening(null);
    setRecoveryOpeningId(null);
    setIdempotencyKey(null);
    setIntentPhase(null);
    setManualReviewCode(null);
    setSavingsChallenge(null);
    setStepUpProof("");
    setError(undefined);
    setStep("input");
    if (userId) {
      void clearSavingsIntent(userId).catch(() => undefined);
    }
  }, [intentPhase, manualReviewCode, userId]);

  const handleSubmit = useCallback(async () => {
    if (recoveryBlocked) {
      setError("Chưa xác định an toàn yêu cầu trước đó. Hãy kiểm tra lại dữ liệu khôi phục.");
      return;
    }
    if (submitLockRef.current) {
      return;
    }
    if (manualReviewCode) {
      setError(MANUAL_REVIEW_MESSAGE);
      return;
    }

    if (!quote || !idempotencyKey) {
      setError("Phiên mở tiền gửi chưa sẵn sàng. Vui lòng tạo lại báo giá.");
      return;
    }
    if (!userId) {
      setError("Phiên đăng nhập không còn hợp lệ.");
      return;
    }
    if (isQuoteExpired && intentPhase !== "SUBMIT_UNKNOWN") {
      setError("Báo giá đã hết hạn. Vui lòng tạo báo giá mới.");
      return;
    }
    if (!stepUpProof.trim()) {
      setError("Mã xác thực bước hai là bắt buộc.");
      return;
    }
    if (!savingsChallenge || isSavingsChallengeUnavailable) {
      setError("Mã xác thực đã hết hạn. Vui lòng tạo mã mới.");
      return;
    }
    if (!savingsChallenge.methods.includes(stepUpMethod)) {
      setError("Phương thức xác thực không được hỗ trợ cho yêu cầu này.");
      return;
    }
    submitLockRef.current = true;
    setIsSubmitting(true);
    setError(undefined);
    let requestStarted = false;
    try {
      await saveSavingsIntent({
        phase: "SUBMIT_UNKNOWN",
        submitAttempted: true,
        userId,
        idempotencyKey,
        quote,
        createdAt: Date.now(),
      });
      setIntentPhase("SUBMIT_UNKNOWN");
      requestStarted = true;
      const response = await submitSavingsOpening(
        {
          quoteId: quote.quoteId,
          stepUp: {
            method: stepUpMethod,
            proof: stepUpProof,
            challengeId: savingsChallenge.challengeId,
          },
        },
        { auth, idempotencyKey },
      );
      setOpening(response);
      setRecoveryOpeningId(response.openingId);
      setStep("result");
      const acceptedPhase =
        response.status === "PENDING"
          ? "ACCEPTED_PENDING"
          : "ACCEPTED_TERMINAL";
      await saveSavingsIntent({
        phase: acceptedPhase,
        submitAttempted: true,
        userId,
        idempotencyKey,
        quote,
        createdAt: Date.now(),
        openingId: response.openingId,
        opening: response,
      }).catch(() => undefined);
      setIntentPhase(acceptedPhase);
      setManualReviewCode(null);
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError));
      if (
        requestStarted &&
        requestError instanceof ApiError &&
        (requestError.code === "QUOTE_EXPIRED" ||
          requestError.code === "NOT_FOUND")
      ) {
        await clearSavingsIntent(userId).catch(() => undefined);
        setSavingsChallenge(null);
        setStepUpProof("");
        setIdempotencyKey(null);
        setIntentPhase(null);
        setManualReviewCode(null);
        setQuote(null);
        setOpening(null);
        setRecoveryOpeningId(null);
        setStep("input");
      } else if (requestStarted && requiresManualReview(requestError)) {
        await saveSavingsIntent({
          phase: "SUBMIT_UNKNOWN",
          submitAttempted: true,
          userId,
          idempotencyKey,
          quote,
          createdAt: Date.now(),
          manualReviewCode: requestError.code,
        }).catch(() => undefined);
        setManualReviewCode(requestError.code);
        setSavingsChallenge(null);
        setStepUpProof("");
        setError(MANUAL_REVIEW_MESSAGE);
      } else if (requestStarted && !shouldKeepSubmitUnknown(requestError)) {
        setSavingsChallenge(null);
        setStepUpProof("");
        await saveSavingsIntent({
          phase: "DRAFT_QUOTE",
          submitAttempted: false,
          userId,
          idempotencyKey,
          quote,
          createdAt: Date.now(),
        }).catch(() => undefined);
        setIntentPhase("DRAFT_QUOTE");
        setManualReviewCode(null);
      }
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  }, [auth, idempotencyKey, intentPhase, isQuoteExpired, isSavingsChallengeUnavailable, manualReviewCode, quote, recoveryBlocked, savingsChallenge, stepUpMethod, stepUpProof, userId]);

  const handleBiometric = useCallback(async () => {
    if (recoveryBlocked) {
      setError("Chưa xác định an toàn yêu cầu trước đó. Hãy kiểm tra lại dữ liệu khôi phục.");
      return;
    }
    if (manualReviewCode) {
      setError(MANUAL_REVIEW_MESSAGE);
      return;
    }
    if (!savingsChallenge?.methods.includes("BIOMETRIC")) {
      setError("Challenge hiện tại không cho phép xác thực sinh trắc học.");
      return;
    }
    if (Date.now() >= Date.parse(savingsChallenge.expiresAt)) {
      setError("Mã xác thực đã hết hạn. Vui lòng tạo mã mới.");
      return;
    }
    setIsSubmitting(true);
    setError(undefined);
    try {
      await requestBiometricAuthentication("Xác thực mở tiền gửi");
      const stored =
        userId && deviceId ? await loadBiometricCredential(userId, deviceId) : null;
      const proof =
        stored && savingsChallenge && deviceId
          ? createDeviceBoundBiometricAssertion({
              biometricSecret: stored.biometricSecret,
              challengeId: savingsChallenge.challengeId,
              deviceId,
              purpose: "SAVINGS_OPENING",
              resourceId: quote?.quoteId ?? null,
            })
          : getDeviceBoundAssertion();
      if (!proof) {
        setError("Thiết bị chưa kích hoạt khóa Sinh trắc học. Vui lòng thiết lập trong Bảo mật tài khoản.");
        return;
      }
      setStepUpMethod("BIOMETRIC");
      setStepUpProof(proof);
    } catch (biometricError: unknown) {
      setError(getErrorMessage(biometricError));
    } finally {
      setIsSubmitting(false);
    }
  }, [deviceId, manualReviewCode, quote, recoveryBlocked, savingsChallenge, userId]);

  const handleRenewSavingsChallenge = useCallback(async () => {
    if (!quote || submitLockRef.current || manualReviewCode || recoveryBlocked) {
      if (manualReviewCode) setError(MANUAL_REVIEW_MESSAGE);
      return;
    }
    submitLockRef.current = true;
    setIsSubmitting(true);
    setError(undefined);
    try {
      const challenge = await createOtpChallenge(
        { purpose: "SAVINGS_OPENING", resourceId: quote.quoteId },
        auth,
      );
      applySavingsChallenge(challenge);
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError));
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  }, [applySavingsChallenge, auth, manualReviewCode, quote, recoveryBlocked]);

  const handleRefreshOpening = useCallback(async () => {
    if (submitLockRef.current) {
      return;
    }
    const openingId = opening?.openingId ?? recoveryOpeningId;
    if (!openingId) {
      return;
    }
    submitLockRef.current = true;
    setIsSubmitting(true);
    setError(undefined);
    try {
      const latestOpening = await getSavingsOpening(openingId, auth);
      setOpening(latestOpening);
      setRecoveryOpeningId(latestOpening.openingId);
      const latestPhase =
        latestOpening.status === "PENDING"
          ? "ACCEPTED_PENDING"
          : "ACCEPTED_TERMINAL";
      setIntentPhase(latestPhase);
      if (userId && quote && idempotencyKey) {
        await saveSavingsIntent({
          phase: latestPhase,
          submitAttempted: true,
          userId,
          idempotencyKey,
          quote,
          createdAt: Date.now(),
          openingId: latestOpening.openingId,
          opening: latestOpening,
        });
      }
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError));
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  }, [auth, idempotencyKey, opening, quote, recoveryOpeningId, userId]);

  const handleBack = useCallback(async () => {
    if (isSubmitting || submitLockRef.current) {
      return;
    }
    if (intentPhase === "ACCEPTED_TERMINAL" && userId) {
      await clearSavingsIntent(userId).catch(() => undefined);
    }
    router.back();
  }, [intentPhase, isSubmitting, router, userId]);

  const handleOpenSavingsList = useCallback(async () => {
    if (isSubmitting || submitLockRef.current) {
      return;
    }
    if (intentPhase === "ACCEPTED_TERMINAL" && userId) {
      await clearSavingsIntent(userId).catch(() => undefined);
    }
    router.replace("/savings");
  }, [intentPhase, isSubmitting, router, userId]);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <AppHeader
          backTestID="savings-open-back"
          eyebrow="Tích lũy"
          onBack={() => void handleBack()}
          subtitle="Chọn nguồn tiền, kỳ hạn và phương án đáo hạn phù hợp."
          title="Mở khoản tiết kiệm"
        />
        <EnvironmentBadge />

        {isLoading || isRestoringIntent ? (
          <View style={styles.centerState} testID="savings-open-loading">
            <ActivityIndicator color={colors.primary} size="large" />
          </View>
        ) : recoveryBlocked ? (
          <View style={styles.card} testID="savings-recovery-blocked">
            <Text style={styles.cardTitle}>Chưa thể khôi phục an toàn</Text>
            <Text style={styles.description}>
              {error ?? "Không thể đọc trạng thái yêu cầu trước đó. Chưa cho phép tạo khoản mới để tránh trùng lệnh."}
            </Text>
            <PrimaryButton
              label="Kiểm tra lại dữ liệu khôi phục"
              onPress={() => {
                setError(undefined);
                void restoreIntent();
              }}
              testID="savings-recovery-retry"
            />
          </View>
        ) : !isAvailable ? (
          <View style={styles.card} testID="savings-open-disabled">
            <Text style={styles.cardTitle}>Tiền gửi đang tạm dừng</Text>
            <Text style={styles.description}>{error ?? "Chính sách server chưa cho phép mở tiền gửi."}</Text>
            <PrimaryButton label="Tải lại" onPress={loadInitialData} testID="savings-open-retry" />
          </View>
        ) : step === "input" ? (
          <View style={styles.card}>
            {hasActiveTotp === false ? (
              <TotpRequiredNotice
                actionLabel="Thiết lập mã TOTP ngay"
                message="Bạn cần thiết lập Google Authenticator trước khi tạo sổ tiết kiệm mới."
                testID="savings-input-totp-notice"
                title="Chưa kích hoạt mã TOTP"
              />
            ) : null}
            <Text style={styles.stepTitle}>1. Chọn nguồn và kỳ hạn</Text>
            <Text style={styles.fieldLabel}>Tài khoản thanh toán</Text>
            <View style={styles.optionList}>
              {accounts.map((account) => (
                <OptionButton
                  key={account.id}
                  selected={account.id === sourceAccountId}
                  label={`${account.displayName} · ${account.maskedNumber} (${formatVndMinor(account.availableBalance.amountMinor)})`}
                  onPress={() => setSourceAccountId(account.id)}
                  testID={`savings-source-${account.id}`}
                />
              ))}
            </View>
            <Text style={styles.fieldLabel}>Sản phẩm</Text>
            <View style={styles.optionList}>
              {products.map((product) => (
                <OptionButton
                  key={product.productId}
                  selected={product.productId === productId}
                  label={`${product.name} · ${formatSavingsRate(product.annualRateBasisPoints)}`}
                  onPress={() => setProductId(product.productId)}
                  testID={`savings-product-${product.termMonths}`}
                />
              ))}
            </View>
            <TextField
              accessibilityLabel="Số tiền gửi"
              error={error}
              keyboardType="number-pad"
              helperText="Nhập số tiền bằng VND, không dùng dấu chấm hoặc dấu phẩy."
              label="Số tiền gửi (VND)"
              onChangeText={(value) => {
                setAmountMinor(value.replace(/\D/g, ""));
                setError(undefined);
              }}
              placeholder="Ví dụ: 1000000"
              testID="savings-amount"
              value={amountMinor}
            />
            <Text style={styles.fieldLabel}>Chỉ thị khi đáo hạn</Text>
            <View style={styles.optionList}>
              {maturityInstructions.map((instruction) => (
                <OptionButton
                  key={instruction}
                  selected={instruction === maturityInstruction}
                  label={getMaturityInstructionLabel(instruction)}
                  onPress={() => setMaturityInstruction(instruction)}
                  testID={`savings-instruction-${instruction}`}
                />
              ))}
            </View>
            <PrimaryButton disabled={isSubmitting} label={isSubmitting ? "Đang tính lãi..." : "Xem báo giá"} onPress={handleQuote} testID="savings-create-quote" />
          </View>
        ) : step === "review" ? (
          <View style={styles.card}>
            <Text style={styles.stepTitle}>2. Kiểm tra báo giá</Text>
            <View style={styles.reviewCard}>
              <SummaryRow label="Tài khoản nguồn" value={quote?.sourceAccountMaskedNumber ?? sourceAccount?.maskedNumber ?? "—"} />
              <SummaryRow label="Kỳ hạn" value={quote ? `${quote.termMonths} tháng` : "—"} />
              <SummaryRow label="Lãi suất áp dụng" value={quote ? formatSavingsRate(quote.annualRateBasisPoints) : "—"} />
              <SummaryRow label="Tiền gốc" value={quote ? formatVndMinor(quote.principal.amountMinor) : "—"} />
              <SummaryRow label="Lãi dự kiến" value={quote ? formatVndMinor(quote.expectedInterest.amountMinor) : "—"} />
              <SummaryRow label="Tổng khi đáo hạn" value={quote ? formatVndMinor(quote.totalAtMaturity.amountMinor) : "—"} />
              <SummaryRow label="Ngày đáo hạn" value={quote ? new Date(quote.maturityAt).toLocaleDateString("vi-VN") : "—"} />
              <SummaryRow label="Chỉ thị" value={quote ? getMaturityInstructionLabel(quote.maturityInstruction) : "—"} />
              <SummaryRow
                label="Báo giá còn hiệu lực"
                value={formatRemainingSeconds(quoteRemainingSeconds)}
              />
            </View>
            {error ? (
              isTotpNotEnrolledError(error) ? (
                <TotpRequiredNotice
                  actionLabel="Thiết lập mã TOTP ngay"
                  message={error}
                  testID="savings-review-totp-notice"
                />
              ) : (
                <Text style={styles.errorText}>{error}</Text>
              )
            ) : null}
            <PrimaryButton
              disabled={isSubmitting || isQuoteExpired}
              label={isSubmitting ? "Đang lưu..." : isQuoteExpired ? "Báo giá đã hết hạn" : "Xác nhận và xác thực"}
              onPress={handleConfirmReview}
              testID="savings-review-confirm"
            />
            <PrimaryButton
              disabled={Boolean(manualReviewCode)}
              label={manualReviewCode ? "Đang chờ đối soát" : "Chỉnh sửa thông tin"}
              onPress={handleEditInput}
              testID="savings-edit-input"
            />
          </View>
        ) : step === "stepUp" ? (
          <View style={styles.card}>
            <Text style={styles.stepTitle}>3. Xác thực yêu cầu</Text>
            <Text style={styles.description}>Hoàn tất bước bảo mật trước khi mở khoản tiền gửi.</Text>
            <Text style={styles.description}>Báo giá còn hiệu lực: {formatRemainingSeconds(quoteRemainingSeconds)}</Text>
            <Text style={styles.description}>Mã xác thực còn hiệu lực: {formatRemainingSeconds(challengeRemainingSeconds)}</Text>
            {savingsChallenge?.methods.some((method) => method === "OTP" || method === "TOTP") ? (
              <PrimaryButton disabled={isSubmitting} label={stepUpMethod === "TOTP" ? "Đang dùng mã TOTP" : "Dùng mã TOTP (Google Authenticator)"} onPress={() => { setStepUpMethod("TOTP"); setStepUpProof(""); }} testID="savings-step-up-otp" />
            ) : null}
            {savingsChallenge?.methods.includes("BIOMETRIC") ? (
              <PrimaryButton disabled={isSubmitting} label={stepUpMethod === "BIOMETRIC" ? "Xác thực lại bằng sinh trắc học" : "Dùng sinh trắc học"} onPress={handleBiometric} testID="savings-step-up-biometric" />
            ) : null}
            {stepUpMethod === "OTP" || stepUpMethod === "TOTP" ? (
              <TextField accessibilityLabel="Mã xác thực mở tiền gửi" editable={!manualReviewCode} error={error} label={stepUpMethod === "TOTP" ? "Mã TOTP (Google Authenticator)" : "Mã xác thực"} onChangeText={(value) => { setStepUpProof(value); setError(undefined); }} placeholder="Nhập 6 chữ số TOTP" secureTextEntry testID="savings-step-up-code" value={stepUpProof} />
            ) : (
              <Text style={styles.description}>{stepUpProof ? "Đã xác thực trên thiết bị. Có thể gửi yêu cầu." : "Chọn xác thực sinh trắc học để tiếp tục."}</Text>
            )}
            {manualReviewCode ? <Text style={styles.errorText}>Mã đối soát: {manualReviewCode}</Text> : null}
            {error ? (
              isTotpNotEnrolledError(error) ? (
                <TotpRequiredNotice
                  actionLabel="Thiết lập mã TOTP ngay"
                  message={error}
                  testID="savings-stepup-totp-notice"
                />
              ) : (
                <Text style={styles.errorText}>{error}</Text>
              )
            ) : null}
            {isSavingsChallengeUnavailable ? <PrimaryButton disabled={isSubmitting || Boolean(manualReviewCode)} label={manualReviewCode ? "Đang chờ đối soát" : isSubmitting ? "Đang tạo lại..." : "Tạo challenge mới"} onPress={handleRenewSavingsChallenge} testID="savings-step-up-renew" /> : null}
            <PrimaryButton disabled={isSubmitting || Boolean(manualReviewCode) || isSavingsChallengeUnavailable || (isQuoteExpired && intentPhase !== "SUBMIT_UNKNOWN")} label={manualReviewCode ? "Không thể gửi lại" : isSubmitting ? "Đang mở..." : isSavingsChallengeUnavailable ? "Challenge đã hết hạn" : isQuoteExpired && intentPhase !== "SUBMIT_UNKNOWN" ? "Báo giá đã hết hạn" : "Mở khoản tiền gửi"} onPress={handleSubmit} testID="savings-submit" />
            <PrimaryButton disabled={Boolean(manualReviewCode)} label={manualReviewCode ? "Đang chờ đối soát" : "Chỉnh sửa thông tin"} onPress={handleEditInput} testID="savings-edit-input" />
          </View>
        ) : (
          <View style={styles.card} testID="savings-open-result">
            <Text style={styles.stepTitle}>4. Kết quả mở khoản</Text>
            <Text style={styles.resultTitle}>{opening ? getSavingsOpeningStatusLabel(opening.status) : "Chưa có kết quả"}</Text>
            <Text style={styles.description}>Mã tham chiếu: {opening?.reference ?? "—"}</Text>
            {opening?.status === "PENDING" || (!opening && recoveryOpeningId) ? (
              <>
                <Text style={styles.description}>Yêu cầu đang được xử lý. Bạn có thể mở lại ứng dụng và cập nhật trạng thái mà không tạo yêu cầu trùng.</Text>
                <PrimaryButton disabled={isSubmitting} label={isSubmitting ? "Đang cập nhật..." : "Cập nhật trạng thái"} onPress={handleRefreshOpening} testID="savings-opening-refresh" />
              </>
            ) : null}
            {opening?.status === "FAILED" || opening?.status === "REVERSED" ? <Text style={styles.errorText}>{opening.failureReason ?? "Yêu cầu không hoàn tất."}</Text> : null}
            <PrimaryButton disabled={isSubmitting} label="Xem danh sách tiền gửi" onPress={handleOpenSavingsList} testID="savings-open-list" />
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

function OptionButton({ label, onPress, selected, testID }: { label: string; onPress: () => void; selected: boolean; testID: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[styles.optionButton, selected ? styles.optionButtonSelected : null]} testID={testID}>
      <Text style={[styles.optionText, selected ? styles.optionTextSelected : null]}>{label}</Text>
    </Pressable>
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
  content: { flexGrow: 1, width: "100%", maxWidth: sizes.contentMaxWidth, alignSelf: "center", padding: spacing.lg, gap: spacing.lg },
  description: { ...typography.body, color: colors.muted },
  centerState: { minHeight: 220, alignItems: "center", justifyContent: "center" },
  card: { gap: spacing.md, padding: spacing.mlg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, ...shadows.card },
  stepTitle: { ...typography.heading, color: colors.text },
  cardTitle: { ...typography.subheading, color: colors.text },
  fieldLabel: { ...typography.label, color: colors.text },
  optionList: { gap: spacing.sm },
  optionButton: { minHeight: 52, justifyContent: "center", paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
  optionButtonSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  optionText: { ...typography.label, color: colors.text },
  optionTextSelected: { color: colors.primary, fontWeight: "800" },
  reviewCard: { gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.background },
  summaryRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md },
  summaryLabel: { ...typography.body, color: colors.muted },
  summaryValue: { flex: 1, ...typography.bodyStrong, color: colors.text, textAlign: "right" },
  errorText: { ...typography.body, padding: spacing.md, borderRadius: radius.md, color: colors.danger, backgroundColor: colors.dangerSoft },
  resultTitle: { ...typography.title, color: colors.text },
});
