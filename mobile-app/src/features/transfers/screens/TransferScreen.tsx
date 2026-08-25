import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { Screen } from "@/components/ui/Screen";
import { TextField } from "@/components/ui/TextField";
import { useAuth } from "@/features/auth/context/AuthContext";
import type { AuthChallengeResponse } from "@/features/auth/types/auth";
import { listAccounts } from "@/features/accounts/services/accountsApi";
import type { PaymentAccount } from "@/features/accounts/types/account";
import { formatVndMinor } from "@/features/banking/presentation/formatMoney";
import type { ClientIntentPhase } from "@/features/banking/domain/clientIntentLifecycle";
import {
  requiresManualReview,
  shouldKeepSubmitUnknown,
  type ManualReviewCode,
} from "@/features/banking/domain/submitFailure";
import { createIdempotencyKey } from "@/features/banking/validation/idempotencyKey";
import { getControlPolicy } from "@/features/control/services/controlPolicyApi";
import type {
  ControlPolicy,
  StepUpMethod,
} from "@/features/control/types/controlPolicy";
import { ApiError } from "@/services/api/ApiError";
import {
  getDeviceBoundAssertion,
  requestBiometricAuthentication,
} from "@/services/security/biometricAuth";
import {
  lookupBeneficiary,
  lookupInternalRecipient,
  quoteTransfer,
  submitTransfer,
  getTransfer,
} from "@/features/transfers/services/transfersApi";
import { createOtpChallenge } from "@/features/auth/services/otpApi";
import type {
  Beneficiary,
  TransferQuote,
  TransferReceipt,
} from "@/features/transfers/types/transfer";
import {
  clearTransferIntent,
  loadTransferIntent,
  saveTransferIntent,
} from "@/features/transfers/storage/transferIntentStorage";
import { colors, spacing } from "@/theme";

type TransferStep = "beneficiary" | "amount" | "review" | "stepUp" | "result";

function getErrorMessage(error: unknown): string {
  if (
    error instanceof ApiError &&
    error.code === "STEP_UP_VERIFICATION_FAILED"
  ) {
    return "Xác thực bước hai không thành công. Vui lòng tạo challenge mới và thử lại.";
  }
  return error instanceof ApiError
    ? error.message
    : "Không thể thực hiện yêu cầu. Vui lòng thử lại.";
}

const MANUAL_REVIEW_MESSAGE =
  "Yêu cầu này cần được đối soát thủ công. Không gửi lại hoặc tạo challenge mới; vui lòng liên hệ hỗ trợ.";

function getReceiptStatusLabel(status: TransferReceipt["status"]): string {
  switch (status) {
    case "PENDING":
      return "Giao dịch đang được xử lý";
    case "SUCCEEDED":
      return "Giao dịch thành công";
    case "FAILED":
      return "Giao dịch thất bại";
    case "REVERSED":
      return "Giao dịch đã hoàn tác";
  }
}

export function TransferScreen() {
  const router = useRouter();
  const routeParams = useLocalSearchParams<{ beneficiaryId?: string }>();
  const { deviceId, refreshAccessToken, session } = useAuth();
  const accessToken = session?.accessToken ?? null;
  const userId = session?.user.id ?? null;
  const initialBeneficiaryId =
    typeof routeParams.beneficiaryId === "string" ? routeParams.beneficiaryId : "";
  const auth = useMemo(
    () => ({ accessToken, deviceId, refreshAccessToken }),
    [accessToken, deviceId, refreshAccessToken],
  );
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [sourceAccountId, setSourceAccountId] = useState<string | null>(null);
  const [beneficiaryId, setBeneficiaryId] = useState(initialBeneficiaryId);
  const [recipientAccountNumber, setRecipientAccountNumber] = useState("");
  const [recipientLookupId, setRecipientLookupId] = useState<string | null>(null);
  const [beneficiary, setBeneficiary] = useState<Beneficiary | null>(null);
  const [amountMinor, setAmountMinor] = useState("");
  const [quote, setQuote] = useState<TransferQuote | null>(null);
  const [stepUpMethod, setStepUpMethod] = useState<StepUpMethod>("OTP");
  const [stepUpProof, setStepUpProof] = useState("");
  const [transferChallenge, setTransferChallenge] =
    useState<AuthChallengeResponse | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [intentPhase, setIntentPhase] = useState<ClientIntentPhase | null>(null);
  const [manualReviewCode, setManualReviewCode] =
    useState<ManualReviewCode | null>(null);
  const [receipt, setReceipt] = useState<TransferReceipt | null>(null);
  const [recoveryTransferId, setRecoveryTransferId] = useState<string | null>(null);
  const [step, setStep] = useState<TransferStep>("beneficiary");
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(true);
  const [controlPolicy, setControlPolicy] = useState<ControlPolicy | null>(null);
  const [isLoadingControlPolicy, setIsLoadingControlPolicy] = useState(true);
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

  const applyTransferChallenge = useCallback(
    (challenge: AuthChallengeResponse) => {
      if (challenge.purpose && challenge.purpose !== "TRANSFER") {
        throw new Error("Máy chủ trả challenge không đúng mục đích chuyển tiền.");
      }
      setTransferChallenge(challenge);
      setStepUpMethod((currentMethod) =>
        challenge.methods.includes(currentMethod)
          ? currentMethod
          : challenge.methods.find(
              (method): method is StepUpMethod =>
                method === "OTP" || method === "TOTP" || method === "BIOMETRIC",
            ) ?? "OTP",
      );
      setStepUpProof("");
    },
    [],
  );

  const loadAccounts = useCallback(async () => {
    if (!accessToken) {
      setIsLoadingAccounts(false);
      return;
    }

    setIsLoadingAccounts(true);
    setError(undefined);

    try {
      const response = await listAccounts(auth);
      setAccounts(response.accounts);
      setSourceAccountId(response.accounts[0]?.id ?? null);
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsLoadingAccounts(false);
    }
  }, [accessToken, auth]);

  useEffect(() => {
    void Promise.resolve().then(() => loadAccounts());
  }, [loadAccounts]);

  const loadControlPolicy = useCallback(async () => {
    if (!accessToken) {
      setControlPolicy(null);
      setIsLoadingControlPolicy(false);
      return;
    }

    setIsLoadingControlPolicy(true);
    setError(undefined);

    try {
      const response = await getControlPolicy(auth);
      setControlPolicy(response);
      setStepUpMethod((currentMethod) =>
        response.stepUpMethods.includes(currentMethod)
          ? currentMethod
          : response.stepUpMethods[0] ?? "OTP",
      );
      setStepUpProof("");
    } catch (requestError: unknown) {
      setControlPolicy(null);
      setError(getErrorMessage(requestError));
    } finally {
      setIsLoadingControlPolicy(false);
    }
  }, [accessToken, auth]);

  useEffect(() => {
    void Promise.resolve().then(() => loadControlPolicy());
  }, [loadControlPolicy]);

  const restoreTransferIntent = useCallback(async () => {
    if (!userId) {
      setIsRestoringIntent(false);
      return;
    }

    setIsRestoringIntent(true);

    try {
      const intent = await loadTransferIntent(userId);

      if (!intent) {
        setRecoveryBlocked(false);
        return;
      }

      setRecoveryBlocked(false);
      setQuote(intent.quote);
      setBeneficiary(intent.quote.beneficiary);
      setBeneficiaryId(intent.quote.beneficiary.id);
      setRecipientLookupId(null);
      setSourceAccountId(intent.quote.sourceAccountId);
      setAmountMinor(intent.quote.amount.amountMinor);
      setIdempotencyKey(intent.idempotencyKey);
      setIntentPhase(intent.phase);
      setManualReviewCode(intent.manualReviewCode ?? null);

      if (intent.transferId) {
        setRecoveryTransferId(intent.transferId);
        setReceipt(intent.receipt ?? null);
        setStep("result");
        const latestReceipt = await getTransfer(intent.transferId, auth);
        setReceipt(latestReceipt);
        const latestPhase =
          latestReceipt.status === "PENDING"
            ? "ACCEPTED_PENDING"
            : "ACCEPTED_TERMINAL";
        setIntentPhase(latestPhase);
        setManualReviewCode(null);
        await saveTransferIntent({
          phase: latestPhase,
          submitAttempted: true,
          userId,
          idempotencyKey: intent.idempotencyKey,
          quote: intent.quote,
          createdAt: intent.createdAt,
          transferId: latestReceipt.transferId,
          receipt: latestReceipt,
        });
      } else {
        setStep("stepUp");
        if (intent.manualReviewCode) {
          setTransferChallenge(null);
          setStepUpProof("");
          setError(MANUAL_REVIEW_MESSAGE);
          return;
        }
        const challenge = await createOtpChallenge(
          { purpose: "TRANSFER", resourceId: intent.quote.quoteId },
          auth,
        );
        applyTransferChallenge(challenge);
      }
    } catch (requestError: unknown) {
      setRecoveryBlocked(true);
      setError(getErrorMessage(requestError));
    } finally {
      setIsRestoringIntent(false);
    }
  }, [applyTransferChallenge, auth, userId]);

  useEffect(() => {
    void Promise.resolve().then(() => restoreTransferIntent());
  }, [restoreTransferIntent]);

  const handleLookupBeneficiary = useCallback(async () => {
    if (recoveryBlocked) {
      setError("Chưa xác định an toàn yêu cầu trước đó. Hãy kiểm tra lại dữ liệu khôi phục.");
      return;
    }
    if (!beneficiaryId.trim() && !recipientAccountNumber.trim()) {
      setError("Nhập số tài khoản người nhận hoặc chọn người nhận đã lưu.");
      return;
    }

    setIsSubmitting(true);
    setError(undefined);

    try {
      if (recipientAccountNumber.trim()) {
        const response = await lookupInternalRecipient(recipientAccountNumber, auth);
        if (response.recipient.status !== "ACTIVE") {
          setError("Tài khoản người nhận hiện không khả dụng.");
          return;
        }
        setRecipientLookupId(response.recipient.lookupId);
        setBeneficiaryId("");
        setBeneficiary({
          id: response.recipient.lookupId,
          displayName: response.recipient.accountHolderName,
          accountHolderName: response.recipient.accountHolderName,
          maskedAccountNumber: response.recipient.maskedAccountNumber,
          bankName: response.recipient.bankName,
          status: response.recipient.status,
        });
        setStep("amount");
        return;
      }

      const response = await lookupBeneficiary(beneficiaryId, auth);

      if (response.beneficiary.status !== "ACTIVE") {
        setError("Người nhận hiện không khả dụng.");
        return;
      }

      setBeneficiary(response.beneficiary);
      setRecipientLookupId(null);
      setStep("amount");
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsSubmitting(false);
    }
  }, [auth, beneficiaryId, recoveryBlocked, recipientAccountNumber]);

  const handleCreateQuote = useCallback(async () => {
    if (recoveryBlocked) {
      setError("Chưa xác định an toàn yêu cầu trước đó. Hãy kiểm tra lại dữ liệu khôi phục.");
      return;
    }
    if (!sourceAccountId) {
      setError("Chưa có tài khoản nguồn khả dụng.");
      return;
    }

    if (!beneficiary) {
      setError("Chưa có người nhận hợp lệ.");
      return;
    }

    if (
      !controlPolicy ||
      controlPolicy.globalKillSwitch ||
      !controlPolicy.transfersEnabled ||
      !controlPolicy.allowlisted
    ) {
      setError("Tính năng chuyển tiền đang tạm dừng theo chính sách server.");
      return;
    }

    const normalizedAmount = amountMinor.trim();

    if (!/^[1-9]\d*$/.test(normalizedAmount)) {
      setError("Số tiền phải là số nguyên dương theo minor unit VND.");
      return;
    }

    if (BigInt(normalizedAmount) > BigInt(controlPolicy.maxTransferAmountMinor)) {
      setError("Số tiền vượt quá hạn mức chuyển trong phiên này.");
      return;
    }

    setIsSubmitting(true);
    setError(undefined);

    try {
      const response = await quoteTransfer(
        {
          sourceAccountId,
          ...(recipientLookupId
            ? { lookupId: recipientLookupId }
            : { beneficiaryId: beneficiary.id }),
          amount: { currency: "VND", amountMinor: normalizedAmount },
        },
        auth,
      );
      setQuote(response);
      setStep("review");
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsSubmitting(false);
    }
  }, [amountMinor, auth, beneficiary, controlPolicy, recoveryBlocked, recipientLookupId, sourceAccountId]);

  const handleContinueToStepUp = useCallback(async () => {
    if (recoveryBlocked) {
      setError("Chưa xác định an toàn yêu cầu trước đó. Hãy kiểm tra lại dữ liệu khôi phục.");
      return;
    }
    if (submitLockRef.current) {
      return;
    }

    if (!quote) {
      setError("Chưa có báo giá hợp lệ.");
      return;
    }

    if (!userId) {
      setError("Phiên đăng nhập không còn hợp lệ.");
      return;
    }

    if (Date.now() >= Date.parse(quote.expiresAt)) {
      setError("Báo giá đã hết hạn. Vui lòng tạo báo giá mới.");
      return;
    }

    submitLockRef.current = true;
    setIsSubmitting(true);
    setError(undefined);

    try {
      const nextIdempotencyKey =
        idempotencyKey ?? createIdempotencyKey("transfer");

      await saveTransferIntent({
        phase: "DRAFT_QUOTE",
        submitAttempted: false,
        userId,
        idempotencyKey: nextIdempotencyKey,
        quote,
        createdAt: Date.now(),
      });
      const challenge = await createOtpChallenge(
        { purpose: "TRANSFER", resourceId: quote.quoteId },
        auth,
      );
      applyTransferChallenge(challenge);
      setIdempotencyKey(nextIdempotencyKey);
      setIntentPhase("DRAFT_QUOTE");
      setManualReviewCode(null);
      setStep("stepUp");
    } catch (storageError: unknown) {
      setError(getErrorMessage(storageError));
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  }, [applyTransferChallenge, auth, idempotencyKey, quote, recoveryBlocked, userId]);

  const handleSubmitTransfer = useCallback(async () => {
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
      setError("Phiên chuyển tiền chưa sẵn sàng. Vui lòng thực hiện lại.");
      return;
    }

    if (!userId) {
      setError("Phiên đăng nhập không còn hợp lệ.");
      return;
    }

    if (
      intentPhase !== "SUBMIT_UNKNOWN" &&
      Date.now() >= Date.parse(quote.expiresAt)
    ) {
      setError("Báo giá đã hết hạn. Vui lòng tạo báo giá mới.");
      return;
    }

    if (!stepUpProof.trim()) {
      setError("Mã xác thực bước hai là bắt buộc.");
      return;
    }

    if (
      !transferChallenge ||
      clockMs >= Date.parse(transferChallenge.expiresAt)
    ) {
      setError("Challenge xác thực đã hết hạn. Vui lòng tạo challenge mới.");
      return;
    }

    if (!transferChallenge.methods.includes(stepUpMethod)) {
      setError("Phương thức xác thực không được challenge hiện tại cho phép.");
      return;
    }

    submitLockRef.current = true;
    setIsSubmitting(true);
    setError(undefined);

    let requestStarted = false;
    try {
      await saveTransferIntent({
        phase: "SUBMIT_UNKNOWN",
        submitAttempted: true,
        userId,
        idempotencyKey,
        quote,
        createdAt: Date.now(),
      });
      setIntentPhase("SUBMIT_UNKNOWN");
      requestStarted = true;
      const response = await submitTransfer(
        {
          quoteId: quote.quoteId,
          stepUp: {
            method: stepUpMethod,
            proof: stepUpProof,
            challengeId: transferChallenge.challengeId,
          },
        },
        { auth, idempotencyKey },
      );
      const acceptedPhase =
        response.status === "PENDING"
          ? "ACCEPTED_PENDING"
          : "ACCEPTED_TERMINAL";
      await saveTransferIntent({
        phase: acceptedPhase,
        submitAttempted: true,
        userId,
        idempotencyKey,
        quote,
        createdAt: Date.now(),
        transferId: response.transferId,
        receipt: response,
      }).catch(() => undefined);
      setReceipt(response);
      setRecoveryTransferId(response.transferId);
      setIntentPhase(acceptedPhase);
      setManualReviewCode(null);
      setStep("result");
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError));
      if (
        requestStarted &&
        requestError instanceof ApiError &&
        (requestError.code === "QUOTE_EXPIRED" ||
          requestError.code === "NOT_FOUND")
      ) {
        await clearTransferIntent(userId).catch(() => undefined);
        setTransferChallenge(null);
        setIdempotencyKey(null);
        setIntentPhase(null);
        setManualReviewCode(null);
        setQuote(null);
        setRecoveryTransferId(null);
        setStep("amount");
      } else if (requestStarted && requiresManualReview(requestError)) {
        await saveTransferIntent({
          phase: "SUBMIT_UNKNOWN",
          submitAttempted: true,
          userId,
          idempotencyKey,
          quote,
          createdAt: Date.now(),
          manualReviewCode: requestError.code,
        }).catch(() => undefined);
        setManualReviewCode(requestError.code);
        setTransferChallenge(null);
        setStepUpProof("");
        setError(MANUAL_REVIEW_MESSAGE);
      } else if (requestStarted && !shouldKeepSubmitUnknown(requestError)) {
        setTransferChallenge(null);
        setStepUpProof("");
        await saveTransferIntent({
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
  }, [auth, clockMs, idempotencyKey, intentPhase, manualReviewCode, quote, recoveryBlocked, stepUpMethod, stepUpProof, transferChallenge, userId]);

  const handleBiometricStepUp = useCallback(async () => {
    if (recoveryBlocked) {
      setError("Chưa xác định an toàn yêu cầu trước đó. Hãy kiểm tra lại dữ liệu khôi phục.");
      return;
    }
    if (manualReviewCode) {
      setError(MANUAL_REVIEW_MESSAGE);
      return;
    }
    if (!transferChallenge?.methods.includes("BIOMETRIC")) {
      setError("Challenge hiện tại không cho phép xác thực sinh trắc học.");
      return;
    }
    if (Date.now() >= Date.parse(transferChallenge.expiresAt)) {
      setError("Challenge xác thực đã hết hạn. Vui lòng tạo challenge mới.");
      return;
    }
    setIsSubmitting(true);
    setError(undefined);

    try {
      await requestBiometricAuthentication("Xác thực giao dịch");
      const biometricProof = getDeviceBoundAssertion();
      if (!biometricProof) {
        setError("Backend/risk provider chưa cung cấp biometric assertion.");
        return;
      }

      setStepUpMethod("BIOMETRIC");
      setStepUpProof(biometricProof);
    } catch (biometricError: unknown) {
      setError(getErrorMessage(biometricError));
    } finally {
      setIsSubmitting(false);
    }
  }, [manualReviewCode, recoveryBlocked, transferChallenge]);

  const handleRenewTransferChallenge = useCallback(async () => {
    if (!quote || submitLockRef.current || manualReviewCode || recoveryBlocked) {
      if (manualReviewCode) setError(MANUAL_REVIEW_MESSAGE);
      return;
    }
    submitLockRef.current = true;
    setIsSubmitting(true);
    setError(undefined);
    try {
      const challenge = await createOtpChallenge(
        { purpose: "TRANSFER", resourceId: quote.quoteId },
        auth,
      );
      applyTransferChallenge(challenge);
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError));
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  }, [applyTransferChallenge, auth, manualReviewCode, quote, recoveryBlocked]);

  const handleRefreshTransferStatus = useCallback(async () => {
    if (submitLockRef.current) {
      return;
    }
    const transferId = receipt?.transferId ?? recoveryTransferId;
    if (!transferId) {
      return;
    }

    submitLockRef.current = true;
    setIsSubmitting(true);
    setError(undefined);

    try {
      const latestReceipt = await getTransfer(transferId, auth);
      setReceipt(latestReceipt);
      setRecoveryTransferId(latestReceipt.transferId);
      const latestPhase =
        latestReceipt.status === "PENDING"
          ? "ACCEPTED_PENDING"
          : "ACCEPTED_TERMINAL";
      setIntentPhase(latestPhase);

      if (userId && quote && idempotencyKey) {
        await saveTransferIntent({
          phase: latestPhase,
          submitAttempted: true,
          userId,
          idempotencyKey,
          quote,
          createdAt: Date.now(),
          transferId: latestReceipt.transferId,
          receipt: latestReceipt,
        });
      }
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError));
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  }, [auth, idempotencyKey, quote, receipt, recoveryTransferId, userId]);

  const handleBack = useCallback(async () => {
    if (isSubmitting || submitLockRef.current) {
      return;
    }
    if (intentPhase === "ACCEPTED_TERMINAL" && userId) {
      await clearTransferIntent(userId).catch(() => undefined);
    }
    router.back();
  }, [intentPhase, isSubmitting, router, userId]);

  const handleGoHome = useCallback(async () => {
    if (isSubmitting || submitLockRef.current) {
      return;
    }
    if (intentPhase === "ACCEPTED_TERMINAL" && userId) {
      await clearTransferIntent(userId).catch(() => undefined);
    }
    router.replace("/");
  }, [intentPhase, isSubmitting, router, userId]);

  const sourceAccount = accounts.find((account) => account.id === sourceAccountId);
  const isTransferChallengeUnavailable =
    !transferChallenge || clockMs >= Date.parse(transferChallenge.expiresAt);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: isSubmitting }}
          disabled={isSubmitting}
          hitSlop={8}
          onPress={handleBack}
          style={styles.backButton}
        >
          <Text style={styles.backLabel}>‹ Quay lại</Text>
        </Pressable>

        <View style={styles.header}>
          <Text style={styles.eyebrow}>CHUYỂN TIỀN</Text>
          <Text style={styles.title}>Tạo giao dịch</Text>
          <Text style={styles.description}>
            Mỗi lần submit dùng một idempotency key để retry không tạo giao dịch trùng.
          </Text>
        </View>

        {isLoadingAccounts || isLoadingControlPolicy || isRestoringIntent ? (
          <View style={styles.centerState}>
            <ActivityIndicator color={colors.primary} size="large" />
          </View>
        ) : recoveryBlocked ? (
          <View style={styles.formCard}>
            <Text style={styles.stepTitle}>Chưa thể khôi phục an toàn</Text>
            <Text style={styles.errorText}>
              {error ?? "Không thể đọc trạng thái yêu cầu trước đó. Chưa cho phép tạo giao dịch mới để tránh trùng lệnh."}
            </Text>
            <PrimaryButton
              label="Kiểm tra lại dữ liệu khôi phục"
              onPress={() => {
                setError(undefined);
                void restoreTransferIntent();
              }}
              testID="transfer-recovery-retry"
            />
          </View>
        ) : !controlPolicy ||
          controlPolicy.globalKillSwitch ||
          !controlPolicy.transfersEnabled ||
          !controlPolicy.allowlisted ? (
          <View style={styles.formCard}>
            <Text style={styles.stepTitle}>Chuyển tiền đang tạm dừng</Text>
            <Text style={styles.errorText}>
              {error ??
                "Chính sách server chưa cho phép chuyển tiền trong phiên pilot này."}
            </Text>
            <PrimaryButton label="Tải lại chính sách" onPress={loadControlPolicy} />
          </View>
        ) : step === "beneficiary" ? (
          <View style={styles.formCard}>
            <Text style={styles.stepTitle}>1. Người nhận</Text>
            <PrimaryButton
              label="Mở danh bạ người nhận"
              onPress={() => router.push("/beneficiaries")}
              testID="transfer-open-beneficiaries"
            />
            <TextField
              accessibilityLabel="Số tài khoản người nhận"
              autoCapitalize="none"
              error={error}
              keyboardType="number-pad"
              label="Số tài khoản người nhận"
              onChangeText={(value) => {
                setRecipientAccountNumber(value.replace(/\D/g, ""));
                setBeneficiaryId("");
                setRecipientLookupId(null);
                setError(undefined);
              }}
              placeholder="Nhập đủ 6–34 chữ số"
              testID="transfer-beneficiary-id"
              value={recipientAccountNumber}
            />
            {beneficiaryId ? (
              <Text style={styles.description}>Người nhận đã lưu: {beneficiary?.displayName ?? beneficiaryId}</Text>
            ) : null}
            <PrimaryButton
              disabled={isSubmitting}
              label={isSubmitting ? "Đang tra cứu..." : "Tiếp tục"}
              onPress={handleLookupBeneficiary}
              testID="transfer-lookup-beneficiary"
            />
          </View>
        ) : step === "amount" ? (
          <View style={styles.formCard}>
            <Text style={styles.stepTitle}>2. Số tiền</Text>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Người nhận</Text>
              <Text style={styles.summaryValue}>{beneficiary?.displayName}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Tài khoản nguồn</Text>
              <Text style={styles.summaryValue}>
                {sourceAccount?.maskedNumber ?? "Chưa chọn"}
              </Text>
            </View>
            <TextField
              accessibilityLabel="Số tiền chuyển"
              error={error}
              keyboardType="number-pad"
              label="Số tiền (minor unit VND)"
              onChangeText={(value) => {
                setAmountMinor(value.replace(/\D/g, ""));
                setError(undefined);
              }}
              placeholder="Ví dụ: 100000"
              testID="transfer-amount"
              value={amountMinor}
            />
            <PrimaryButton
              disabled={isSubmitting}
              label={isSubmitting ? "Đang tính phí..." : "Xem phí và review"}
              onPress={handleCreateQuote}
              testID="transfer-create-quote"
            />
          </View>
        ) : step === "review" ? (
          <View style={styles.formCard}>
            <Text style={styles.stepTitle}>3. Review</Text>
            <View style={styles.reviewCard}>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Người nhận</Text>
                <Text style={styles.summaryValue}>{quote?.beneficiary.displayName}</Text>
              </View>
            <Text style={styles.description}>
              {beneficiary?.accountHolderName ?? beneficiary?.maskedAccountNumber}
              {beneficiary?.bankName ? ` · ${beneficiary.bankName}` : ""}
            </Text>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Số tiền</Text>
                <Text style={styles.summaryValue}>
                  {quote ? formatVndMinor(quote.amount.amountMinor) : "—"}
                </Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Phí</Text>
                <Text style={styles.summaryValue}>
                  {quote ? formatVndMinor(quote.fee.amountMinor) : "—"}
                </Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.totalLabel}>Tổng ghi nợ</Text>
                <Text style={styles.totalValue}>
                  {quote ? formatVndMinor(quote.totalDebit.amountMinor) : "—"}
                </Text>
              </View>
            </View>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <PrimaryButton
              disabled={isSubmitting}
              label={isSubmitting ? "Đang lưu..." : "Xác nhận và xác thực"}
              onPress={handleContinueToStepUp}
              testID="transfer-review-confirm"
            />
          </View>
        ) : step === "stepUp" ? (
          <View style={styles.formCard}>
            <Text style={styles.stepTitle}>4. Xác thực bước hai</Text>
            <Text style={styles.description}>
              Backend/risk engine sẽ quyết định chính sách TOTP hoặc sinh trắc học.
            </Text>
            {transferChallenge?.methods.some((method) => method === "OTP" || method === "TOTP") ? (
              <PrimaryButton
                disabled={isSubmitting}
                label={stepUpMethod === "TOTP" ? "Đang dùng TOTP" : stepUpMethod === "OTP" ? "Đang dùng mã xác thực" : "Dùng mã TOTP"}
                onPress={() => {
                  setStepUpMethod(transferChallenge.methods.includes("TOTP") ? "TOTP" : "OTP");
                  setStepUpProof("");
                  setError(undefined);
                }}
                testID="transfer-step-up-otp"
              />
            ) : null}
            {transferChallenge?.methods.includes("BIOMETRIC") ? (
              <PrimaryButton
                disabled={isSubmitting}
                label={
                  stepUpMethod === "BIOMETRIC"
                    ? "Xác thực lại bằng sinh trắc học"
                    : "Dùng sinh trắc học"
                }
                onPress={handleBiometricStepUp}
                testID="transfer-step-up-biometric"
              />
            ) : null}
            {stepUpMethod === "OTP" || stepUpMethod === "TOTP" ? (
              <TextField
                accessibilityLabel="Mã xác thực bước hai"
                autoCapitalize="none"
                editable={!manualReviewCode}
                error={error}
                label={stepUpMethod === "TOTP" ? "Mã TOTP" : "Mã xác thực"}
                onChangeText={(value) => {
                  setStepUpProof(value);
                  setError(undefined);
                }}
                placeholder="Nhập mã xác thực"
                secureTextEntry
                testID="transfer-step-up-code"
                value={stepUpProof}
              />
            ) : (
              <Text style={styles.description}>
                {stepUpProof
                  ? "Đã xác thực trên thiết bị. Có thể gửi giao dịch."
                  : "Chọn xác thực sinh trắc học để tiếp tục."}
              </Text>
            )}
            {manualReviewCode ? (
              <Text style={styles.errorText}>
                Mã đối soát: {manualReviewCode}
              </Text>
            ) : null}
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            {isTransferChallengeUnavailable ? (
              <PrimaryButton
                disabled={isSubmitting || Boolean(manualReviewCode)}
                label={
                  manualReviewCode
                    ? "Đang chờ đối soát"
                    : isSubmitting
                      ? "Đang tạo lại..."
                      : "Tạo challenge mới"
                }
                onPress={handleRenewTransferChallenge}
                testID="transfer-step-up-renew"
              />
            ) : null}
            <PrimaryButton
              disabled={
                isSubmitting ||
                isTransferChallengeUnavailable ||
                Boolean(manualReviewCode)
              }
              label={
                manualReviewCode
                  ? "Không thể gửi lại"
                  : isSubmitting
                    ? "Đang gửi..."
                    : isTransferChallengeUnavailable
                      ? "Challenge đã hết hạn"
                      : "Gửi giao dịch"
              }
              onPress={handleSubmitTransfer}
              testID="transfer-submit"
            />
          </View>
        ) : (
          <View style={styles.formCard}>
            <Text style={styles.stepTitle}>5. Trạng thái giao dịch</Text>
            <Text style={styles.resultTitle}>
              {receipt ? getReceiptStatusLabel(receipt.status) : "Chưa có kết quả"}
            </Text>
            <Text style={styles.description}>
              Mã tham chiếu: {receipt?.reference ?? "—"}
            </Text>
            <Text style={styles.description}>
              Nếu trạng thái là đang xử lý, hãy mở lại lịch sử sau khi app khởi động lại.
            </Text>
            {receipt?.status === "PENDING" || (!receipt && recoveryTransferId) ? (
              <PrimaryButton
                disabled={isSubmitting}
                label={isSubmitting ? "Đang cập nhật..." : "Cập nhật trạng thái"}
                onPress={handleRefreshTransferStatus}
                testID="transfer-status-refresh"
              />
            ) : null}
            <PrimaryButton disabled={isSubmitting} label="Về trang chủ" onPress={handleGoHome} />
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
    padding: spacing.lg,
    gap: spacing.lg,
  },
  backButton: {
    alignSelf: "flex-start",
    paddingVertical: spacing.xs,
  },
  backLabel: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: "600",
  },
  header: {
    gap: spacing.sm,
  },
  eyebrow: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.4,
  },
  title: {
    color: colors.text,
    fontSize: 30,
    fontWeight: "700",
  },
  description: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  centerState: {
    minHeight: 160,
    alignItems: "center",
    justifyContent: "center",
  },
  formCard: {
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing.md,
    backgroundColor: colors.surface,
  },
  stepTitle: {
    color: colors.text,
    fontSize: 19,
    fontWeight: "700",
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  summaryLabel: {
    color: colors.muted,
    fontSize: 14,
  },
  summaryValue: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    fontWeight: "600",
    textAlign: "right",
  },
  reviewCard: {
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: spacing.sm,
    backgroundColor: colors.background,
  },
  totalLabel: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  totalValue: {
    flex: 1,
    color: colors.primary,
    fontSize: 16,
    fontWeight: "700",
    textAlign: "right",
  },
  errorText: {
    color: colors.danger,
    fontSize: 14,
    lineHeight: 20,
  },
  resultTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "700",
  },
});
