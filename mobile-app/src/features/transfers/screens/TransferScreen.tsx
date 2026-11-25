/* eslint-disable react-hooks/preserve-manual-memoization */
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
  lookupExternalRecipient,
  lookupInternalRecipient,
  quoteTransfer,
  submitTransfer,
  getTransfer,
} from "@/features/transfers/services/transfersApi";
import { createOtpChallenge } from "@/features/auth/services/otpApi";
import { listMfaMethods } from "@/features/auth/services/authApi";
import { loadBiometricCredential } from "@/features/auth/storage/biometricCredentialStorage";
import { isTotpNotEnrolledError, TOTP_NOT_ENROLLED_MESSAGE } from "@/features/auth/utils/totpError";
import {
  createDeviceBoundBiometricAssertion,
  requestBiometricAuthentication,
} from "@/services/security/biometricAuth";
import { TransferProgress } from "@/features/transfers/components/TransferProgress";
import {
  TransferAmountStep,
  TransferBeneficiaryStep,
  TransferResultStep,
  TransferReviewStep,
  TransferStepUpStep,
  stepStyles,
} from "@/features/transfers/components/TransferStepViews";
import {
  NAPAS_BANKS,
  type Beneficiary,
  type TransferQuote,
  type TransferRail,
  type TransferReceipt,
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
const BIOMETRIC_TRANSFER_LIMIT_MINOR = 1_000_000n;

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
    bankBin?: string;
    amountMinor?: string;
    description?: string;
  }>();
  const { deviceId, refreshAccessToken, session } = useAuth();
  const accessToken = session?.accessToken ?? null;
  const userId = session?.user.id ?? null;
  const initialBeneficiaryId =
    typeof routeParams.beneficiaryId === "string" ? routeParams.beneficiaryId : "";
  const initialAccountNumber =
    typeof routeParams.accountNumber === "string" ? routeParams.accountNumber : "";
  const initialBankBin =
    typeof routeParams.bankBin === "string" ? routeParams.bankBin.trim() : "";
  const initialAmountMinor =
    typeof routeParams.amountMinor === "string" ? routeParams.amountMinor.trim() : "";
  const initialDescription =
    typeof routeParams.description === "string" ? routeParams.description.trim() : "";

  const isInitialExternalBin = Boolean(
    initialBankBin && initialBankBin !== "970400"
  );

  const auth = useMemo(
    () => ({ accessToken, deviceId, refreshAccessToken }),
    [accessToken, deviceId, refreshAccessToken],
  );
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [sourceAccountId, setSourceAccountId] = useState<string | null>(null);
  const [transferRail, setTransferRail] = useState<TransferRail>(
    isInitialExternalBin ? "NAPAS_IBFT" : "INTERNAL"
  );
  const [selectedBankBin, setSelectedBankBin] = useState<string>(
    isInitialExternalBin
      ? initialBankBin
      : (NAPAS_BANKS.find((b) => b.bin === initialBankBin)?.bin ?? NAPAS_BANKS[0]!.bin)
  );
  const [beneficiaryId, setBeneficiaryId] = useState(initialBeneficiaryId);
  const [recipientAccountNumber, setRecipientAccountNumber] = useState(initialAccountNumber);
  const [recipientLookupId, setRecipientLookupId] = useState<string | null>(null);
  const [beneficiary, setBeneficiary] = useState<Beneficiary | null>(null);
  const [amountMinor, setAmountMinor] = useState(
    initialAmountMinor && /^[1-9]\d*$/.test(initialAmountMinor) ? initialAmountMinor : ""
  );
  const [transferDescription] = useState(initialDescription);
  const [quote, setQuote] = useState<TransferQuote | null>(null);
  const [confirmHighRisk, setConfirmHighRisk] = useState(false);
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
  const normalizedRouteBankBin = initialBankBin;
  const isExternalRoute = Boolean(
    normalizedRouteAccountNumber &&
      normalizedRouteBankBin &&
      normalizedRouteBankBin !== "970400"
  );

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
      setStepUpMethod(challenge.method === "BIOMETRIC" ? "BIOMETRIC" : "TOTP");
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
  const [hasActiveBiometric, setHasActiveBiometric] = useState(false);

  const checkMfaStatus = useCallback(async () => {
    if (!accessToken || !deviceId) {
      setHasActiveTotp(null);
      setHasActiveBiometric(false);
      return;
    }
    try {
      const response = await listMfaMethods({
        accessToken,
        deviceId,
        refreshAccessToken,
      });
      const hasBio = response.items.some(
        (m) =>
          m.status === "ACTIVE" &&
          m.credentialType === "BIOMETRIC" &&
          (!m.deviceId || m.deviceId === deviceId),
      );
      const hasActive = response.items.some(
        (m) =>
          m.status === "ACTIVE" &&
          (m.credentialType === "TOTP" ||
            (m.credentialType === "BIOMETRIC" && (!m.deviceId || m.deviceId === deviceId))),
      );
      setHasActiveBiometric(hasBio);
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
      setConfirmHighRisk(Boolean(intent.confirmHighRisk));
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
          ...(intent.confirmHighRisk ? { confirmHighRisk: true } : {}),
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
          setConfirmHighRisk(false);
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
            setConfirmHighRisk(false);
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
    setConfirmHighRisk(false);
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
      rail?: TransferRail;
      bankBin?: string;
      isCancelled?: () => boolean;
    }) => {
      const accountNumber = target.accountNumber?.trim() ?? "";
      const savedBeneficiaryId = target.beneficiaryId?.trim() ?? "";
      const effectiveRail = target.rail ?? transferRail;
      const effectiveBankBin = target.bankBin ?? selectedBankBin;

      if (!savedBeneficiaryId && !accountNumber) {
        setError("Nhập số tài khoản người nhận hoặc chọn người nhận đã lưu.");
        return;
      }

      setIsSubmitting(true);
      setError(undefined);

      try {
        if (accountNumber && effectiveRail === "NAPAS_IBFT") {
          const response = await lookupExternalRecipient(effectiveBankBin, accountNumber, auth);
          if (target.isCancelled?.()) return;
          if (response.recipient.status !== "ACTIVE") {
            setError("Tài khoản người nhận liên ngân hàng hiện không khả dụng.");
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
    [auth, selectedBankBin, transferRail],
  );

  const handleLookupBeneficiary = useCallback(async () => {
    if (recoveryBlocked) {
      setError("Chưa xác định an toàn yêu cầu trước đó. Hãy kiểm tra lại dữ liệu khôi phục.");
      return;
    }
    await performRecipientLookup({
      accountNumber: recipientAccountNumber,
      beneficiaryId,
      rail: transferRail,
      bankBin: selectedBankBin,
    });
  }, [beneficiaryId, performRecipientLookup, recipientAccountNumber, recoveryBlocked, selectedBankBin, transferRail]);

  useEffect(() => {
    const routeTargetKey = normalizedRouteAccountNumber
      ? `account:${normalizedRouteBankBin ? normalizedRouteBankBin + ":" : ""}${normalizedRouteAccountNumber}`
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
      rail: isExternalRoute ? "NAPAS_IBFT" : "INTERNAL",
      bankBin: isExternalRoute ? normalizedRouteBankBin : selectedBankBin,
      isCancelled: () => cancelled,
    });

    return () => {
      cancelled = true;
    };
  }, [
    accessToken,
    controlPolicy,
    intentPhase,
    isExternalRoute,
    isLoadingAccounts,
    isLoadingControlPolicy,
    isRestoringIntent,
    normalizedRouteAccountNumber,
    normalizedRouteBankBin,
    normalizedRouteBeneficiaryId,
    performRecipientLookup,
    quote,
    receipt,
    recoveryBlocked,
    selectedBankBin,
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
      setConfirmHighRisk(false);
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

    if (quote.anomalyAssessment?.riskLevel === "CRITICAL" && !confirmHighRisk) {
      setError("Vui lòng xác nhận cảnh báo rủi ro nghiêm trọng trước khi tiếp tục.");
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
        ...(confirmHighRisk ? { confirmHighRisk: true } : {}),
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
  }, [applyTransferChallenge, auth, confirmHighRisk, idempotencyKey, quote, recoveryBlocked, userId]);

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
        ...(confirmHighRisk ? { confirmHighRisk: true } : {}),
      });
      setIntentPhase("SUBMIT_UNKNOWN");
      requestStarted = true;
      const response = await submitTransfer(
        {
          quoteId: quote.quoteId,
          ...(confirmHighRisk ? { confirmHighRisk: true } : {}),
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
        ...(confirmHighRisk ? { confirmHighRisk: true } : {}),
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
        setConfirmHighRisk(false);
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
          ...(confirmHighRisk ? { confirmHighRisk: true } : {}),
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
          ...(confirmHighRisk ? { confirmHighRisk: true } : {}),
        }).catch(() => undefined);
        setIntentPhase("DRAFT_QUOTE");
        setManualReviewCode(null);
      }
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  }, [auth, clockMs, confirmHighRisk, idempotencyKey, intentPhase, manualReviewCode, quote, recoveryBlocked, stepUpMethod, stepUpProof, transferChallenge, userId]);

  const isBiometricEligibleForQuote = useMemo(() => {
    if (!quote) return false;
    try {
      const amount = BigInt(quote.amount.amountMinor);
      const riskLevel = quote.anomalyAssessment?.riskLevel;
      return (
        amount <= BIOMETRIC_TRANSFER_LIMIT_MINOR &&
        riskLevel !== "HIGH" &&
        riskLevel !== "CRITICAL"
      );
    } catch {
      return false;
    }
  }, [quote]);

  const handleBiometricTransferStepUp = useCallback(async () => {
    if (submitLockRef.current || manualReviewCode || recoveryBlocked) {
      if (manualReviewCode) setError(MANUAL_REVIEW_MESSAGE);
      return;
    }
    if (!quote || !userId || !deviceId || !transferChallenge) {
      setError("Phiên xác thực chuyển tiền chưa sẵn sàng.");
      return;
    }
    if (!isBiometricEligibleForQuote) {
      setError(
        "Giao dịch trên 1.000.000 VND hoặc có cảnh báo rủi ro cao bắt buộc xác thực bằng mã TOTP.",
      );
      return;
    }
    if (!hasActiveBiometric && !transferChallenge.methods.includes("BIOMETRIC")) {
      setError("Challenge hiện tại chưa bật xác thực sinh trắc học.");
      return;
    }
    if (clockMs >= Date.parse(transferChallenge.expiresAt)) {
      setError("Mã xác thực đã hết hạn. Vui lòng tạo mã mới.");
      return;
    }
    setIsSubmitting(true);
    setError(undefined);
    try {
      await requestBiometricAuthentication("Xác thực chuyển khoản NOVA");
      const stored = await loadBiometricCredential(userId, deviceId);
      if (!stored) {
        setError(
          "Thiết bị chưa có khóa Sinh trắc học đã kích hoạt. Vui lòng kích hoạt trong Bảo mật tài khoản.",
        );
        return;
      }
      let activeChallenge = transferChallenge;
      if (activeChallenge.method !== "BIOMETRIC") {
        activeChallenge = await createOtpChallenge(
          {
            purpose: "TRANSFER",
            resourceId: quote.quoteId,
            method: "BIOMETRIC" as never,
          },
          auth,
        );
        applyTransferChallenge(activeChallenge);
      }
      const proof = createDeviceBoundBiometricAssertion({
        biometricSecret: stored.biometricSecret,
        challengeId: activeChallenge.challengeId,
        deviceId,
        purpose: "TRANSFER",
        resourceId: quote.quoteId,
      });
      setStepUpMethod("BIOMETRIC");
      setStepUpProof(proof);
    } catch (biometricError: unknown) {
      setError(getErrorMessage(biometricError));
    } finally {
      setIsSubmitting(false);
    }
  }, [
    applyTransferChallenge,
    auth,
    clockMs,
    deviceId,
    hasActiveBiometric,
    isBiometricEligibleForQuote,
    manualReviewCode,
    quote,
    recoveryBlocked,
    transferChallenge,
    userId,
  ]);

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

  useEffect(() => {
    const shouldPoll =
      step === "result" &&
      Boolean(receipt?.transferId ?? recoveryTransferId) &&
      (receipt?.status === "PENDING" || !receipt);
    if (!shouldPoll) return;
    const timer = setInterval(() => {
      void handleRefreshTransferStatus();
    }, 3000);
    return () => clearInterval(timer);
  }, [handleRefreshTransferStatus, receipt, recoveryTransferId, step]);

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

  const canUseBiometric =
    isBiometricEligibleForQuote &&
    (hasActiveBiometric || Boolean(transferChallenge?.methods.includes("BIOMETRIC")));

  const stepUpHint = useMemo(() => {
    if (!quote) return undefined;
    const riskLevel = quote.anomalyAssessment?.riskLevel;
    if (riskLevel === "HIGH" || riskLevel === "CRITICAL") {
      return "Giao dịch có cảnh báo rủi ro cao — bắt buộc xác thực bằng mã TOTP gồm 6 chữ số.";
    }
    try {
      if (BigInt(quote.amount.amountMinor) > BIOMETRIC_TRANSFER_LIMIT_MINOR) {
        return "Giao dịch trên 1.000.000 VND bắt buộc xác thực bằng mã TOTP gồm 6 chữ số.";
      }
    } catch {
      return undefined;
    }
    return undefined;
  }, [quote]);

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
            onSelectBankBin={(bin) => {
              setSelectedBankBin(bin);
              setRecipientLookupId(null);
              setError(undefined);
            }}
            onSelectRail={(nextRail) => {
              setTransferRail(nextRail);
              setBeneficiaryId("");
              setRecipientLookupId(null);
              setBeneficiary(null);
              setError(undefined);
            }}
            recipientAccountNumber={recipientAccountNumber}
            selectedBankBin={selectedBankBin}
            transferRail={transferRail}
          />
        ) : step === "amount" ? (
          <TransferAmountStep
            accounts={accounts}
            amountMinor={amountMinor}
            beneficiary={beneficiary}
            description={transferDescription}
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
            confirmHighRisk={confirmHighRisk}
            description={transferDescription}
            error={error}
            isSubmitting={isSubmitting}
            isTotpError={Boolean(error && isTotpNotEnrolledError(error))}
            onContinueToStepUp={handleContinueToStepUp}
            onToggleConfirmHighRisk={() => setConfirmHighRisk((prev) => !prev)}
            quote={quote}
          />
        ) : step === "stepUp" ? (
          <TransferStepUpStep
            canUseBiometric={canUseBiometric}
            error={error}
            isSubmitting={isSubmitting}
            isTotpError={Boolean(error && isTotpNotEnrolledError(error))}
            isTransferChallengeUnavailable={isTransferChallengeUnavailable}
            manualReviewCode={manualReviewCode}
            onChangeProof={(value) => {
              setStepUpMethod("TOTP");
              setStepUpProof(value);
              setError(undefined);
            }}
            onRenewChallenge={handleRenewTransferChallenge}
            onSubmitTransfer={handleSubmitTransfer}
            onUseBiometric={handleBiometricTransferStepUp}
            stepUpHint={stepUpHint}
            stepUpMethod={stepUpMethod}
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
