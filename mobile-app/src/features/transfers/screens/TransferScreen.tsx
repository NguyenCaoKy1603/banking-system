import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { AppHeader } from "@/components/ui/AppHeader";
import { Button } from "@/components/ui/Button";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { Screen } from "@/components/ui/Screen";
import { useAuth } from "@/features/auth/context/AuthContext";
import type { AuthChallengeResponse } from "@/features/auth/types/auth";
import { listAccounts } from "@/features/accounts/services/accountsApi";
import type { PaymentAccount } from "@/features/accounts/types/account";
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
  lookupBeneficiary,
  lookupInternalRecipient,
  quoteTransfer,
  submitTransfer,
  getTransfer,
} from "@/features/transfers/services/transfersApi";
import { createOtpChallenge } from "@/features/auth/services/otpApi";
import { listMfaMethods } from "@/features/auth/services/authApi";
import { isTotpNotEnrolledError, TOTP_NOT_ENROLLED_MESSAGE } from "@/features/auth/utils/totpError";
import { TransferProgress } from "@/features/transfers/components/TransferProgress";
import {
  TransferAmountStep,
  TransferBeneficiaryStep,
  TransferResultStep,
  TransferReviewStep,
  TransferStepUpStep,
  stepStyles,
} from "@/features/transfers/components/TransferStepViews";
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
import { colors, sizes, spacing } from "@/theme";

type TransferStep = "beneficiary" | "amount" | "review" | "stepUp" | "result";

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
  if (error instanceof ApiError || error instanceof Error) {
    return error.message;
  }
  return "Không thể thực hiện yêu cầu. Vui lòng thử lại.";
}

const MANUAL_REVIEW_MESSAGE =
  "Yêu cầu này cần được đối soát thủ công. Không gửi lại hoặc tạo mã mới; vui lòng liên hệ hỗ trợ.";

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
  const routeParams = useLocalSearchParams<{
    beneficiaryId?: string;
    accountNumber?: string;
  }>();
  const { deviceId, refreshAccessToken, session } = useAuth();
  const accessToken = session?.accessToken ?? null;
  const userId = session?.user.id ?? null;
  const initialBeneficiaryId =
    typeof routeParams.beneficiaryId === "string" ? routeParams.beneficiaryId : "";
  const initialAccountNumber =
    typeof routeParams.accountNumber === "string" ? routeParams.accountNumber : "";
  const auth = useMemo(
    () => ({ accessToken, deviceId, refreshAccessToken }),
    [accessToken, deviceId, refreshAccessToken],
  );
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [sourceAccountId, setSourceAccountId] = useState<string | null>(null);
  const [beneficiaryId, setBeneficiaryId] = useState(initialBeneficiaryId);
  const [recipientAccountNumber, setRecipientAccountNumber] = useState(initialAccountNumber);
  const [recipientLookupId, setRecipientLookupId] = useState<string | null>(null);
  const [beneficiary, setBeneficiary] = useState<Beneficiary | null>(null);
  const [amountMinor, setAmountMinor] = useState("");
  const [quote, setQuote] = useState<TransferQuote | null>(null);
  const [stepUpMethod, setStepUpMethod] = useState<StepUpMethod>("TOTP");
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
  const appliedRouteTargetRef = useRef<string | null>(null);
  const normalizedRouteAccountNumber = initialAccountNumber.replace(/\D/g, "");
  const normalizedRouteBeneficiaryId = initialBeneficiaryId.trim();

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
      setStepUpMethod("TOTP");
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
      setSourceAccountId((current) =>
        current && response.accounts.some((item) => item.id === current)
          ? current
          : (response.accounts[0]?.id ?? null),
      );
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
      setStepUpMethod("TOTP");
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

  const [hasActiveTotp, setHasActiveTotp] = useState<boolean | null>(null);

  const checkMfaStatus = useCallback(async () => {
    if (!accessToken || !deviceId) {
      setHasActiveTotp(null);
      return;
    }
    try {
      const response = await listMfaMethods({
        accessToken,
        deviceId,
        refreshAccessToken,
      });
      const hasActive = response.items.some(
        (m) => m.status === "ACTIVE" && m.credentialType === "TOTP",
      );
      setHasActiveTotp(hasActive);
    } catch {
      // Non-blocking fail-safe
    }
  }, [accessToken, deviceId, refreshAccessToken]);

  useEffect(() => {
    void Promise.resolve().then(() => checkMfaStatus());
  }, [checkMfaStatus]);

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
        if (
          (!intent.submitAttempted || intent.phase === "DRAFT_QUOTE") &&
          Date.parse(intent.quote.expiresAt) <= Date.now()
        ) {
          await clearTransferIntent(userId).catch(() => undefined);
          setRecoveryBlocked(false);
          setQuote(null);
          setBeneficiary(null);
          setBeneficiaryId("");
          setRecipientAccountNumber("");
          setRecipientLookupId(null);
          setAmountMinor("");
          setIdempotencyKey(null);
          setIntentPhase(null);
          setManualReviewCode(null);
          setTransferChallenge(null);
          setStepUpProof("");
          setStep("beneficiary");
          setError(undefined);
          return;
        }

        try {
          const challenge = await createOtpChallenge(
            { purpose: "TRANSFER", resourceId: intent.quote.quoteId },
            auth,
          );
          applyTransferChallenge(challenge);
        } catch (challengeError: unknown) {
          if (!intent.submitAttempted || intent.phase === "DRAFT_QUOTE") {
            await clearTransferIntent(userId).catch(() => undefined);
            setRecoveryBlocked(false);
            setQuote(null);
            setBeneficiary(null);
            setBeneficiaryId("");
            setRecipientAccountNumber("");
            setRecipientLookupId(null);
            setAmountMinor("");
            setIdempotencyKey(null);
            setIntentPhase(null);
            setManualReviewCode(null);
            setTransferChallenge(null);
            setStepUpProof("");
            setStep("beneficiary");
            setError(undefined);
            return;
          }
          throw challengeError;
        }
      }
    } catch (requestError: unknown) {
      setRecoveryBlocked(true);
      setError(getErrorMessage(requestError));
    } finally {
      setIsRestoringIntent(false);
    }
  }, [applyTransferChallenge, auth, userId]);

  const handleDiscardIntent = useCallback(async () => {
    if (userId) {
      await clearTransferIntent(userId).catch(() => undefined);
    }
    if (Platform.OS === "web" && typeof window !== "undefined" && window.localStorage) {
      try {
        const keysToRemove: string[] = [];
        for (let i = 0; i < window.localStorage.length; i++) {
          const k = window.localStorage.key(i);
          if (k && k.startsWith("banking.transfer.intent")) {
            keysToRemove.push(k);
          }
        }
        keysToRemove.forEach((k) => window.localStorage.removeItem(k));
      } catch {
        // ignore web storage error
      }
    }
    setRecoveryBlocked(false);
    setQuote(null);
    setBeneficiary(null);
    setBeneficiaryId("");
    setRecipientAccountNumber("");
    setRecipientLookupId(null);
    setAmountMinor("");
    setIdempotencyKey(null);
    setIntentPhase(null);
    setManualReviewCode(null);
    setReceipt(null);
    setRecoveryTransferId(null);
    setTransferChallenge(null);
    setStepUpProof("");
    setStep("beneficiary");
    setError(undefined);
  }, [userId]);

  useEffect(() => {
    void Promise.resolve().then(() => restoreTransferIntent());
  }, [restoreTransferIntent]);

  const performRecipientLookup = useCallback(
    async (target: {
      accountNumber?: string;
      beneficiaryId?: string;
      isCancelled?: () => boolean;
    }) => {
      const accountNumber = target.accountNumber?.trim() ?? "";
      const savedBeneficiaryId = target.beneficiaryId?.trim() ?? "";

      if (!savedBeneficiaryId && !accountNumber) {
        setError("Nhập số tài khoản người nhận hoặc chọn người nhận đã lưu.");
        return;
      }

      setIsSubmitting(true);
      setError(undefined);

      try {
        if (accountNumber) {
          const response = await lookupInternalRecipient(accountNumber, auth);
          if (target.isCancelled?.()) return;
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

        const response = await lookupBeneficiary(savedBeneficiaryId, auth);
        if (target.isCancelled?.()) return;

        if (response.beneficiary.status !== "ACTIVE") {
          setError("Người nhận hiện không khả dụng.");
          return;
        }

        setBeneficiary(response.beneficiary);
        setRecipientLookupId(null);
        setStep("amount");
      } catch (requestError: unknown) {
        if (!target.isCancelled?.()) {
          setError(getErrorMessage(requestError));
        }
      } finally {
        if (!target.isCancelled?.()) {
          setIsSubmitting(false);
        }
      }
    },
    [auth],
  );

  const handleLookupBeneficiary = useCallback(async () => {
    if (recoveryBlocked) {
      setError("Chưa xác định an toàn yêu cầu trước đó. Hãy kiểm tra lại dữ liệu khôi phục.");
      return;
    }
    await performRecipientLookup({
      accountNumber: recipientAccountNumber,
      beneficiaryId,
    });
  }, [beneficiaryId, performRecipientLookup, recipientAccountNumber, recoveryBlocked]);

  useEffect(() => {
    const routeTargetKey = normalizedRouteAccountNumber
      ? `account:${normalizedRouteAccountNumber}`
      : normalizedRouteBeneficiaryId
        ? `beneficiary:${normalizedRouteBeneficiaryId}`
        : null;

    if (!routeTargetKey) {
      appliedRouteTargetRef.current = null;
      return;
    }

    if (
      !accessToken ||
      isLoadingAccounts ||
      isLoadingControlPolicy ||
      isRestoringIntent ||
      recoveryBlocked ||
      intentPhase !== null ||
      quote !== null ||
      receipt !== null ||
      !controlPolicy ||
      controlPolicy.globalKillSwitch ||
      !controlPolicy.transfersEnabled ||
      !controlPolicy.allowlisted
    ) {
      return;
    }

    if (appliedRouteTargetRef.current === routeTargetKey) {
      return;
    }
    appliedRouteTargetRef.current = routeTargetKey;

    let cancelled = false;
    setRecipientAccountNumber(normalizedRouteAccountNumber);
    setBeneficiaryId(normalizedRouteAccountNumber ? "" : normalizedRouteBeneficiaryId);
    setRecipientLookupId(null);
    setBeneficiary(null);
    setStep("beneficiary");
    setError(undefined);

    void performRecipientLookup({
      accountNumber: normalizedRouteAccountNumber || undefined,
      beneficiaryId: normalizedRouteAccountNumber ? undefined : normalizedRouteBeneficiaryId,
      isCancelled: () => cancelled,
    });

    return () => {
      cancelled = true;
    };
  }, [
    accessToken,
    controlPolicy,
    intentPhase,
    isLoadingAccounts,
    isLoadingControlPolicy,
    isRestoringIntent,
    normalizedRouteAccountNumber,
    normalizedRouteBeneficiaryId,
    performRecipientLookup,
    quote,
    receipt,
    recoveryBlocked,
  ]);

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
      setError("Số tiền chuyển phải là số nguyên dương.");
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
        { purpose: "TRANSFER", resourceId: quote.quoteId, method: "TOTP" },
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
      setError("Mã xác thực đã hết hạn. Vui lòng tạo mã mới.");
      return;
    }

    if (!transferChallenge.methods.includes(stepUpMethod)) {
      setError("Phương thức xác thực không được hỗ trợ cho yêu cầu này.");
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
        { purpose: "TRANSFER", resourceId: quote.quoteId, method: "TOTP" },
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

  const handleAddAmount = useCallback((addMinor: number) => {
    const current = BigInt(amountMinor || "0");
    const next = current + BigInt(addMinor);
    setAmountMinor(next.toString());
    setError(undefined);
  }, [amountMinor]);

  const handleSetAllBalance = useCallback(() => {
    if (sourceAccount) {
      setAmountMinor(sourceAccount.currentBalance.amountMinor);
      setError(undefined);
    }
  }, [sourceAccount]);

  const isExceedingBalance = useMemo(() => {
    if (!sourceAccount || !amountMinor || amountMinor === "0") return false;
    try {
      return BigInt(amountMinor) > BigInt(sourceAccount.currentBalance.amountMinor);
    } catch {
      return false;
    }
  }, [amountMinor, sourceAccount]);

  const isTransferChallengeUnavailable =
    !transferChallenge || clockMs >= Date.parse(transferChallenge.expiresAt);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <AppHeader
          eyebrow="Chuyển tiền"
          onBack={() => void handleBack()}
          subtitle="Kiểm tra đầy đủ thông tin trước khi xác nhận giao dịch."
          title="Chuyển khoản mới"
        />
        <TransferProgress current={step} />

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
            <Button
              label="Hủy phiên cũ & Bắt đầu giao dịch mới"
              onPress={() => void handleDiscardIntent()}
              testID="transfer-recovery-discard"
              variant="secondary"
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
                "Dịch vụ chuyển tiền đang tạm dừng. Vui lòng thử lại sau."}
            </Text>
            <PrimaryButton label="Tải lại chính sách" onPress={loadControlPolicy} />
          </View>
        ) : step === "beneficiary" ? (
          <TransferBeneficiaryStep
            beneficiary={beneficiary}
            beneficiaryId={beneficiaryId}
            error={error}
            hasActiveTotp={hasActiveTotp}
            isSubmitting={isSubmitting}
            onChangeAccountNumber={(value) => {
              setRecipientAccountNumber(value.replace(/\D/g, ""));
              setBeneficiaryId("");
              setRecipientLookupId(null);
              setError(undefined);
            }}
            onLookup={handleLookupBeneficiary}
            onOpenBeneficiaries={() => router.push("/beneficiaries")}
            recipientAccountNumber={recipientAccountNumber}
          />
        ) : step === "amount" ? (
          <TransferAmountStep
            accounts={accounts}
            amountMinor={amountMinor}
            beneficiary={beneficiary}
            error={error}
            isExceedingBalance={isExceedingBalance}
            isSubmitting={isSubmitting}
            onAddAmount={handleAddAmount}
            onChangeAmount={(value) => {
              setAmountMinor(value.replace(/\D/g, ""));
              setError(undefined);
            }}
            onCreateQuote={handleCreateQuote}
            onSelectSourceAccount={(nextId) => {
              setSourceAccountId(nextId);
              setError(undefined);
            }}
            onSetAllBalance={handleSetAllBalance}
            sourceAccount={sourceAccount}
          />
        ) : step === "review" ? (
          <TransferReviewStep
            beneficiary={beneficiary}
            error={error}
            isSubmitting={isSubmitting}
            isTotpError={Boolean(error && isTotpNotEnrolledError(error))}
            onContinueToStepUp={handleContinueToStepUp}
            quote={quote}
          />
        ) : step === "stepUp" ? (
          <TransferStepUpStep
            error={error}
            isSubmitting={isSubmitting}
            isTotpError={Boolean(error && isTotpNotEnrolledError(error))}
            isTransferChallengeUnavailable={isTransferChallengeUnavailable}
            manualReviewCode={manualReviewCode}
            onChangeProof={(value) => {
              setStepUpProof(value);
              setError(undefined);
            }}
            onRenewChallenge={handleRenewTransferChallenge}
            onSubmitTransfer={handleSubmitTransfer}
            stepUpProof={stepUpProof}
          />
        ) : (
          <TransferResultStep
            isSubmitting={isSubmitting}
            onGoHome={handleGoHome}
            onRefreshStatus={handleRefreshTransferStatus}
            receipt={receipt}
            recoveryTransferId={recoveryTransferId}
            statusLabel={receipt ? getReceiptStatusLabel(receipt.status) : "Chưa có kết quả"}
          />
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
  centerState: {
    minHeight: 160,
    alignItems: "center",
    justifyContent: "center",
  },
  formCard: stepStyles.formCard,
  stepTitle: stepStyles.stepTitle,
  errorText: stepStyles.errorText,
});
