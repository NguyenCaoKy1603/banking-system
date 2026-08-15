import { useCallback, useEffect, useMemo, useState } from "react";
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
import { listAccounts } from "@/features/accounts/services/accountsApi";
import type { PaymentAccount } from "@/features/accounts/types/account";
import { formatVndMinor } from "@/features/banking/presentation/formatMoney";
import { getControlPolicy } from "@/features/control/services/controlPolicyApi";
import type {
  ControlPolicy,
  StepUpMethod,
} from "@/features/control/types/controlPolicy";
import { ApiError } from "@/services/api/ApiError";
import {
  getSandboxBiometricProof,
  requestBiometricAuthentication,
} from "@/services/security/biometricAuth";
import {
  lookupBeneficiary,
  quoteTransfer,
  submitTransfer,
  getTransfer,
} from "@/features/transfers/services/transfersApi";
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

function createTransferIntentId(): string {
  return `transfer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "Không thể thực hiện yêu cầu. Vui lòng thử lại.";
}

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
  const [beneficiary, setBeneficiary] = useState<Beneficiary | null>(null);
  const [amountMinor, setAmountMinor] = useState("");
  const [quote, setQuote] = useState<TransferQuote | null>(null);
  const [stepUpMethod, setStepUpMethod] = useState<StepUpMethod>("OTP");
  const [stepUpProof, setStepUpProof] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<TransferReceipt | null>(null);
  const [step, setStep] = useState<TransferStep>("beneficiary");
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(true);
  const [controlPolicy, setControlPolicy] = useState<ControlPolicy | null>(null);
  const [isLoadingControlPolicy, setIsLoadingControlPolicy] = useState(true);
  const [isRestoringIntent, setIsRestoringIntent] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

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
        return;
      }

      setQuote(intent.quote);
      setBeneficiary(intent.quote.beneficiary);
      setBeneficiaryId(intent.quote.beneficiary.id);
      setSourceAccountId(intent.quote.sourceAccountId);
      setAmountMinor(intent.quote.amount.amountMinor);
      setIdempotencyKey(intent.idempotencyKey);

      if (intent.transferId) {
        const latestReceipt = await getTransfer(intent.transferId, auth);
        setReceipt(latestReceipt);
        setStep("result");

        if (latestReceipt.status !== "PENDING") {
          await clearTransferIntent();
        }
      } else {
        setStep("stepUp");
      }
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsRestoringIntent(false);
    }
  }, [auth, userId]);

  useEffect(() => {
    void Promise.resolve().then(() => restoreTransferIntent());
  }, [restoreTransferIntent]);

  const handleLookupBeneficiary = useCallback(async () => {
    if (!beneficiaryId.trim()) {
      setError("Mã người nhận là bắt buộc.");
      return;
    }

    setIsSubmitting(true);
    setError(undefined);

    try {
      const response = await lookupBeneficiary(beneficiaryId, auth);

      if (response.beneficiary.status !== "ACTIVE") {
        setError("Người nhận hiện không khả dụng.");
        return;
      }

      setBeneficiary(response.beneficiary);
      setStep("amount");
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsSubmitting(false);
    }
  }, [auth, beneficiaryId]);

  const handleCreateQuote = useCallback(async () => {
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
          beneficiaryId: beneficiary.id,
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
  }, [amountMinor, auth, beneficiary, controlPolicy, sourceAccountId]);

  const handleContinueToStepUp = useCallback(async () => {
    if (!quote) {
      setError("Chưa có báo giá hợp lệ.");
      return;
    }

    if (!userId) {
      setError("Phiên đăng nhập không còn hợp lệ.");
      return;
    }

    setIsSubmitting(true);
    setError(undefined);

    try {
      const nextIdempotencyKey = idempotencyKey ?? createTransferIntentId();

      await saveTransferIntent({
        userId,
        idempotencyKey: nextIdempotencyKey,
        quote,
        createdAt: Date.now(),
      });
      setIdempotencyKey(nextIdempotencyKey);
      setStep("stepUp");
    } catch (storageError: unknown) {
      setError(getErrorMessage(storageError));
    } finally {
      setIsSubmitting(false);
    }
  }, [idempotencyKey, quote, userId]);

  const handleSubmitTransfer = useCallback(async () => {
    if (!quote || !idempotencyKey) {
      setError("Phiên chuyển tiền chưa sẵn sàng. Vui lòng thực hiện lại.");
      return;
    }

    if (!stepUpProof.trim()) {
      setError("Mã xác thực bước hai là bắt buộc.");
      return;
    }

    setIsSubmitting(true);
    setError(undefined);

    try {
      const response = await submitTransfer(
        {
          quoteId: quote.quoteId,
          stepUp: { method: stepUpMethod, proof: stepUpProof },
        },
        { auth, idempotencyKey },
      );
      if (userId) {
        await saveTransferIntent({
          userId,
          idempotencyKey,
          quote,
          createdAt: Date.now(),
          transferId: response.transferId,
          receipt: response,
        }).catch(() => undefined);
      }
      setReceipt(response);
      setStep("result");

      if (response.status !== "PENDING") {
        await clearTransferIntent().catch(() => undefined);
      }
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsSubmitting(false);
    }
  }, [auth, idempotencyKey, quote, stepUpMethod, stepUpProof, userId]);

  const handleBiometricStepUp = useCallback(async () => {
    setIsSubmitting(true);
    setError(undefined);

    try {
      await requestBiometricAuthentication("Xác thực giao dịch");
      const biometricProof = getSandboxBiometricProof();
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
  }, []);

  const handleRefreshTransferStatus = useCallback(async () => {
    if (!receipt?.transferId) {
      return;
    }

    setIsSubmitting(true);
    setError(undefined);

    try {
      const latestReceipt = await getTransfer(receipt.transferId, auth);
      setReceipt(latestReceipt);

      if (userId && quote && idempotencyKey) {
        await saveTransferIntent({
          userId,
          idempotencyKey,
          quote,
          createdAt: Date.now(),
          transferId: latestReceipt.transferId,
          receipt: latestReceipt,
        });
      }

      if (latestReceipt.status !== "PENDING") {
        await clearTransferIntent().catch(() => undefined);
      }
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsSubmitting(false);
    }
  }, [auth, idempotencyKey, quote, receipt, userId]);

  const sourceAccount = accounts.find((account) => account.id === sourceAccountId);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => router.back()}
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
              accessibilityLabel="Mã người nhận"
              autoCapitalize="none"
              error={error}
              label="Mã người nhận"
              onChangeText={(value) => {
                setBeneficiaryId(value);
                setError(undefined);
              }}
              placeholder="Nhập mã người nhận"
              testID="transfer-beneficiary-id"
              value={beneficiaryId}
            />
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
              Backend/risk engine sẽ quyết định chính sách OTP hoặc sinh trắc học.
            </Text>
            {controlPolicy?.stepUpMethods.includes("OTP") ? (
              <PrimaryButton
                disabled={isSubmitting}
                label={stepUpMethod === "OTP" ? "Đang dùng OTP" : "Dùng OTP"}
                onPress={() => {
                  setStepUpMethod("OTP");
                  setStepUpProof("");
                  setError(undefined);
                }}
                testID="transfer-step-up-otp"
              />
            ) : null}
            {controlPolicy?.stepUpMethods.includes("BIOMETRIC") ? (
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
            {stepUpMethod === "OTP" ? (
              <TextField
                accessibilityLabel="Mã xác thực bước hai"
                autoCapitalize="none"
                error={error}
                label="Mã xác thực OTP"
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
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <PrimaryButton
              disabled={isSubmitting}
              label={isSubmitting ? "Đang gửi..." : "Gửi giao dịch"}
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
            {receipt?.status === "PENDING" ? (
              <PrimaryButton
                disabled={isSubmitting}
                label={isSubmitting ? "Đang cập nhật..." : "Cập nhật trạng thái"}
                onPress={handleRefreshTransferStatus}
                testID="transfer-status-refresh"
              />
            ) : null}
            <PrimaryButton label="Về trang chủ" onPress={() => router.replace("/")} />
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
