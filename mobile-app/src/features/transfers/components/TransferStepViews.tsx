import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppIcon } from "@/components/ui/AppIcon";
import { Button } from "@/components/ui/Button";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { TextField } from "@/components/ui/TextField";
import type { PaymentAccount } from "@/features/accounts/types/account";
import { getRiskLevelPresentation } from "@/features/anomalies/presentation/anomalyPresentation";
import { TotpRequiredNotice } from "@/features/auth/components/TotpRequiredNotice";
import { formatVndMinor, formatVndWords } from "@/features/banking/presentation/formatMoney";
import type { ManualReviewCode } from "@/features/banking/domain/submitFailure";
import {
  NAPAS_BANKS,
  type Beneficiary,
  type TransferQuote,
  type TransferRail,
  type TransferReceipt,
} from "@/features/transfers/types/transfer";
import { colors, radius, shadows, spacing, typography } from "@/theme";

const QUICK_AMOUNTS = [
  { label: "+50.000", value: 50_000 },
  { label: "+100.000", value: 100_000 },
  { label: "+500.000", value: 500_000 },
  { label: "+1.000.000", value: 1_000_000 },
  { label: "+5.000.000", value: 5_000_000 },
];

export function TransferBeneficiaryStep({
  hasActiveTotp,
  transferRail = "INTERNAL",
  selectedBankBin = NAPAS_BANKS[0]!.bin,
  recipientAccountNumber,
  beneficiaryId,
  beneficiary,
  error,
  isSubmitting,
  onSelectRail,
  onSelectBankBin,
  onOpenBeneficiaries,
  onChangeAccountNumber,
  onLookup,
}: {
  hasActiveTotp: boolean | null;
  transferRail?: TransferRail;
  selectedBankBin?: string;
  recipientAccountNumber: string;
  beneficiaryId: string;
  beneficiary: Beneficiary | null;
  error?: string;
  isSubmitting: boolean;
  onSelectRail?: (rail: TransferRail) => void;
  onSelectBankBin?: (bin: string) => void;
  onOpenBeneficiaries: () => void;
  onChangeAccountNumber: (value: string) => void;
  onLookup: () => void;
}) {
  const selectedBank = NAPAS_BANKS.find((bank) => bank.bin === selectedBankBin);

  return (
    <View style={stepStyles.formCard}>
      {hasActiveTotp === false ? (
        <TotpRequiredNotice
          actionLabel="Thiết lập mã TOTP ngay"
          message="Bạn cần cài đặt Google Authenticator để hoàn tất bước xác thực chuyển tiền."
          testID="transfer-totp-notice"
          title="Chưa kích hoạt mã TOTP"
        />
      ) : null}
      <Text style={stepStyles.stepTitle}>Chọn người nhận</Text>
      {onSelectRail ? (
        <View style={stepStyles.railRow} testID="transfer-rail-selector">
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: transferRail === "INTERNAL" }}
            onPress={() => onSelectRail("INTERNAL")}
            style={[
              stepStyles.railButton,
              transferRail === "INTERNAL" ? stepStyles.railButtonSelected : null,
            ]}
            testID="transfer-rail-internal"
          >
            <Text
              style={[
                stepStyles.railButtonText,
                transferRail === "INTERNAL" ? stepStyles.railButtonTextSelected : null,
              ]}
            >
              Nội bộ NOVA
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: transferRail === "NAPAS_IBFT" }}
            onPress={() => onSelectRail("NAPAS_IBFT")}
            style={[
              stepStyles.railButton,
              transferRail === "NAPAS_IBFT" ? stepStyles.railButtonSelected : null,
            ]}
            testID="transfer-rail-napas"
          >
            <Text
              style={[
                stepStyles.railButtonText,
                transferRail === "NAPAS_IBFT" ? stepStyles.railButtonTextSelected : null,
              ]}
            >
              Liên ngân hàng 24/7 (NAPAS)
            </Text>
          </Pressable>
        </View>
      ) : null}
      {transferRail === "INTERNAL" ? (
        <Button
          icon="users"
          label="Mở danh bạ người nhận"
          onPress={onOpenBeneficiaries}
          testID="transfer-open-beneficiaries"
          variant="secondary"
        />
      ) : (
        <View style={stepStyles.quickAmountContainer} testID="transfer-napas-bank-list">
          <Text style={stepStyles.quickAmountTitle}>Chọn ngân hàng thụ hưởng (NAPAS 24/7):</Text>
          <View style={stepStyles.chipsRow}>
            {NAPAS_BANKS.map((bank) => {
              const selected = bank.bin === selectedBankBin;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  key={bank.bin}
                  onPress={() => onSelectBankBin?.(bank.bin)}
                  style={[stepStyles.chipButton, selected ? stepStyles.allBalanceChip : null]}
                  testID={`transfer-napas-bank-${bank.bin}`}
                >
                  <Text style={[stepStyles.chipText, selected ? stepStyles.allBalanceText : null]}>
                    [{bank.code}] {bank.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {selectedBank ? (
            <Text style={stepStyles.description}>
              Ngân hàng đã chọn: {selectedBank.name} (BIN {selectedBank.bin})
            </Text>
          ) : null}
        </View>
      )}
      <TextField
        accessibilityLabel="Số tài khoản người nhận"
        autoCapitalize="none"
        error={error}
        keyboardType="number-pad"
        label={
          transferRail === "NAPAS_IBFT"
            ? "Số tài khoản liên ngân hàng"
            : "Số tài khoản người nhận"
        }
        onChangeText={onChangeAccountNumber}
        placeholder={
          transferRail === "NAPAS_IBFT"
            ? "Ví dụ: 99990001 (hoặc 99999999 để test lỗi)"
            : "Nhập đủ 6–34 chữ số"
        }
        testID="transfer-beneficiary-id"
        value={recipientAccountNumber}
      />
      {transferRail === "INTERNAL" && beneficiaryId ? (
        <Text style={stepStyles.description}>Người nhận đã lưu: {beneficiary?.displayName ?? beneficiaryId}</Text>
      ) : null}
      <PrimaryButton
        disabled={isSubmitting}
        label={isSubmitting ? "Đang tra cứu..." : "Tiếp tục"}
        onPress={onLookup}
        testID="transfer-lookup-beneficiary"
      />
    </View>
  );
}

export function TransferAmountStep({
  accounts,
  sourceAccount,
  beneficiary,
  amountMinor,
  description,
  error,
  isExceedingBalance,
  isSubmitting,
  onSelectSourceAccount,
  onChangeAmount,
  onAddAmount,
  onSetAllBalance,
  onCreateQuote,
}: {
  accounts: readonly PaymentAccount[];
  sourceAccount?: PaymentAccount;
  beneficiary: Beneficiary | null;
  amountMinor: string;
  description?: string;
  error?: string;
  isExceedingBalance: boolean;
  isSubmitting: boolean;
  onSelectSourceAccount: (accountId: string) => void;
  onChangeAmount: (value: string) => void;
  onAddAmount: (addMinor: number) => void;
  onSetAllBalance: () => void;
  onCreateQuote: () => void;
}) {
  return (
    <View style={stepStyles.formCard}>
      <Text style={stepStyles.stepTitle}>Nhập số tiền</Text>

      <View style={stepStyles.beneficiaryBadge}>
        <View style={stepStyles.beneficiaryIconBlock}>
          <Text style={{ fontSize: 20 }}>👤</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={stepStyles.beneficiaryNameLabel}>{beneficiary?.displayName}</Text>
          <Text style={stepStyles.beneficiarySubLabel}>
            {beneficiary?.maskedAccountNumber ?? ""}
            {beneficiary?.bankName ? ` · ${beneficiary.bankName}` : " · Ngân hàng NOVA"}
          </Text>
        </View>
      </View>

      {accounts.length > 1 ? (
        <View style={stepStyles.quickAmountContainer} testID="transfer-source-account-switcher">
          <Text style={stepStyles.quickAmountTitle}>Chọn tài khoản nguồn:</Text>
          <View style={stepStyles.chipsRow}>
            {accounts.map((item) => {
              const selected = item.id === sourceAccount?.id;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  key={item.id}
                  onPress={() => onSelectSourceAccount(item.id)}
                  style={[stepStyles.chipButton, selected ? stepStyles.allBalanceChip : null]}
                  testID={`transfer-source-account-${item.id}`}
                >
                  <Text style={[stepStyles.chipText, selected ? stepStyles.allBalanceText : null]}>
                    {item.displayName} ({item.maskedNumber})
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      <View style={stepStyles.summaryRow}>
        <Text style={stepStyles.summaryLabel}>Tài khoản nguồn</Text>
        <Text style={stepStyles.summaryValue}>
          {sourceAccount?.maskedNumber ?? "Chưa chọn"}
        </Text>
      </View>

      <View style={stepStyles.summaryRow}>
        <Text style={stepStyles.summaryLabel}>Số dư khả dụng</Text>
        <Text style={[stepStyles.summaryValue, { color: colors.primary, fontWeight: "700" }]}>
          {sourceAccount ? formatVndMinor(sourceAccount.currentBalance.amountMinor) : "—"}
        </Text>
      </View>

      {description ? (
        <View style={stepStyles.summaryRow}>
          <Text style={stepStyles.summaryLabel}>Nội dung chuyển</Text>
          <Text style={stepStyles.summaryValue}>{description}</Text>
        </View>
      ) : null}

      <TextField
        accessibilityLabel="Số tiền chuyển"
        error={error || (isExceedingBalance ? "Số tiền chuyển vượt quá số dư khả dụng." : undefined)}
        keyboardType="number-pad"
        helperText="Nhập số tiền bằng VND, không dùng dấu chấm hoặc dấu phẩy."
        label="Số tiền (VND)"
        onChangeText={onChangeAmount}
        placeholder="Ví dụ: 100000"
        testID="transfer-amount"
        value={amountMinor}
      />

      {amountMinor && amountMinor !== "0" ? (
        <View style={stepStyles.amountPreviewBox}>
          <Text style={stepStyles.amountFormattedText}>{formatVndMinor(amountMinor)}</Text>
          {formatVndWords(amountMinor) ? (
            <Text style={stepStyles.amountWordsText}>{formatVndWords(amountMinor)}</Text>
          ) : null}
        </View>
      ) : null}

      <View style={stepStyles.quickAmountContainer}>
        <Text style={stepStyles.quickAmountTitle}>Chọn nhanh số tiền:</Text>
        <View style={stepStyles.chipsRow}>
          {QUICK_AMOUNTS.map((chip) => (
            <Pressable
              key={chip.label}
              onPress={() => onAddAmount(chip.value)}
              style={({ pressed }) => [stepStyles.chipButton, pressed && stepStyles.chipPressed]}
            >
              <Text style={stepStyles.chipText}>{chip.label}</Text>
            </Pressable>
          ))}
          {sourceAccount ? (
            <Pressable
              onPress={onSetAllBalance}
              style={({ pressed }) => [stepStyles.chipButton, stepStyles.allBalanceChip, pressed && stepStyles.chipPressed]}
            >
              <Text style={[stepStyles.chipText, stepStyles.allBalanceText]}>Toàn bộ số dư</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <PrimaryButton
        disabled={isSubmitting || isExceedingBalance || !amountMinor || amountMinor === "0"}
        label={isSubmitting ? "Đang tính phí..." : "Kiểm tra phí giao dịch"}
        onPress={onCreateQuote}
        testID="transfer-create-quote"
      />
    </View>
  );
}

export function TransferReviewStep({
  quote,
  beneficiary,
  description,
  confirmHighRisk = false,
  onToggleConfirmHighRisk,
  error,
  isTotpError,
  isSubmitting,
  onContinueToStepUp,
}: {
  quote: TransferQuote | null;
  beneficiary: Beneficiary | null;
  description?: string;
  confirmHighRisk?: boolean;
  onToggleConfirmHighRisk?: () => void;
  error?: string;
  isTotpError: boolean;
  isSubmitting: boolean;
  onContinueToStepUp: () => void;
}) {
  const isCriticalRisk = quote?.anomalyAssessment?.riskLevel === "CRITICAL";

  return (
    <View style={stepStyles.formCard}>
      <Text style={stepStyles.stepTitle}>Kiểm tra giao dịch</Text>
      <View style={stepStyles.reviewCard}>
        <View style={stepStyles.summaryRow}>
          <Text style={stepStyles.summaryLabel}>Người nhận</Text>
          <Text style={stepStyles.summaryValue}>{quote?.beneficiary.displayName}</Text>
        </View>
        <Text style={stepStyles.description}>
          {beneficiary?.accountHolderName && beneficiary.displayName !== beneficiary.accountHolderName
            ? `${beneficiary.accountHolderName} · `
            : ""}
          {beneficiary?.maskedAccountNumber ?? ""}
          {beneficiary?.bankName ? ` · ${beneficiary.bankName}` : ""}
        </Text>
        {description ? (
          <View style={stepStyles.summaryRow}>
            <Text style={stepStyles.summaryLabel}>Nội dung</Text>
            <Text style={stepStyles.summaryValue}>{description}</Text>
          </View>
        ) : null}
        <View style={stepStyles.summaryRow}>
          <Text style={stepStyles.summaryLabel}>Số tiền</Text>
          <Text style={stepStyles.summaryValue}>
            {quote ? formatVndMinor(quote.amount.amountMinor) : "—"}
          </Text>
        </View>
        <View style={stepStyles.summaryRow}>
          <Text style={stepStyles.summaryLabel}>Phí</Text>
          <Text style={stepStyles.summaryValue}>
            {quote ? formatVndMinor(quote.fee.amountMinor) : "—"}
          </Text>
        </View>
        <View style={stepStyles.summaryRow}>
          <Text style={stepStyles.totalLabel}>Tổng ghi nợ</Text>
          <Text style={stepStyles.totalValue}>
            {quote ? formatVndMinor(quote.totalDebit.amountMinor) : "—"}
          </Text>
        </View>
      </View>
      {quote?.anomalyAssessment?.flagged ? (
        <View
          style={[
            stepStyles.anomalyBox,
            quote.anomalyAssessment.requiresConfirmation
              ? stepStyles.anomalyBoxDanger
              : stepStyles.anomalyBoxWarning,
          ]}
          testID="transfer-anomaly-warning"
        >
          <View style={stepStyles.anomalyHeader}>
            <AppIcon
              color={
                quote.anomalyAssessment.requiresConfirmation
                  ? colors.danger
                  : colors.warning
              }
              name="alert"
              size={20}
            />
            <Text style={stepStyles.anomalyTitle}>Cảnh báo giao dịch bất thường</Text>
            <StatusBadge
              label={`${getRiskLevelPresentation(quote.anomalyAssessment.riskLevel).label} (${quote.anomalyAssessment.riskScore}/100)`}
              tone={getRiskLevelPresentation(quote.anomalyAssessment.riskLevel).tone}
            />
          </View>
          <Text style={stepStyles.anomalySummary}>{quote.anomalyAssessment.summary}</Text>
          {quote.anomalyAssessment.flags.map((flag) => (
            <Text key={flag.code} style={stepStyles.anomalyFlagText}>
              • {flag.title}: {flag.detail}
            </Text>
          ))}
          {isCriticalRisk && onToggleConfirmHighRisk ? (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: confirmHighRisk }}
              onPress={onToggleConfirmHighRisk}
              style={stepStyles.confirmRiskRow}
              testID="transfer-confirm-high-risk"
            >
              <View
                style={[
                  stepStyles.confirmRiskCheckbox,
                  confirmHighRisk ? stepStyles.confirmRiskCheckboxChecked : null,
                ]}
              >
                {confirmHighRisk ? (
                  <AppIcon color={colors.onPrimary} name="check" size={14} />
                ) : null}
              </View>
              <Text style={stepStyles.confirmRiskLabel}>
                Tôi xác nhận đã kiểm tra kỹ người nhận và vẫn muốn tiếp tục giao dịch rủi ro nghiêm trọng này.
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {error ? (
        isTotpError ? (
          <TotpRequiredNotice
            actionLabel="Thiết lập mã TOTP ngay"
            message={error}
            testID="transfer-review-totp-notice"
          />
        ) : (
          <Text style={stepStyles.errorText}>{error}</Text>
        )
      ) : null}
      <PrimaryButton
        disabled={isSubmitting || (isCriticalRisk && !confirmHighRisk)}
        label={isSubmitting ? "Đang chuẩn bị..." : "Tiếp tục xác thực"}
        onPress={onContinueToStepUp}
        testID="transfer-review-confirm"
      />
    </View>
  );
}

export function TransferStepUpStep({
  stepUpMethod,
  stepUpProof,
  canUseBiometric = false,
  stepUpHint,
  manualReviewCode,
  error,
  isTotpError,
  isTransferChallengeUnavailable,
  isSubmitting,
  onChangeProof,
  onUseBiometric,
  onRenewChallenge,
  onSubmitTransfer,
}: {
  stepUpMethod?: "OTP" | "TOTP" | "BIOMETRIC";
  stepUpProof: string;
  canUseBiometric?: boolean;
  stepUpHint?: string;
  manualReviewCode: ManualReviewCode | null;
  error?: string;
  isTotpError: boolean;
  isTransferChallengeUnavailable: boolean;
  isSubmitting: boolean;
  onChangeProof: (value: string) => void;
  onUseBiometric?: () => void;
  onRenewChallenge: () => void;
  onSubmitTransfer: () => void;
}) {
  const [showTotpFallback, setShowTotpFallback] = useState(false);
  const isBiometricVerified =
    stepUpMethod === "BIOMETRIC" && stepUpProof.trim().length > 0;
  const shouldShowTotpInput =
    !canUseBiometric ||
    showTotpFallback ||
    isTotpError ||
    (stepUpMethod !== "BIOMETRIC" && stepUpProof.trim().length > 0);

  return (
    <View style={stepStyles.formCard}>
      <Text style={stepStyles.stepTitle}>Xác thực giao dịch</Text>
      <Text style={stepStyles.description}>
        {canUseBiometric
          ? "Ưu tiên xác thực nhanh bằng Vân tay / Face ID / Mã PIN thiết bị, hoặc chuyển sang mã TOTP 6 số nếu cần."
          : stepUpHint ??
            "Mở ứng dụng Google Authenticator trên điện thoại để lấy mã TOTP gồm 6 chữ số."}
      </Text>
      {canUseBiometric && onUseBiometric ? (
        <Button
          disabled={isSubmitting || isTransferChallengeUnavailable || Boolean(manualReviewCode)}
          icon="fingerprint"
          label={
            isBiometricVerified
              ? "Đã xác thực Vân tay / Face ID — Bấm để quét lại"
              : "Xác thực bằng Vân tay / Face ID"
          }
          onPress={onUseBiometric}
          testID="transfer-step-up-biometric"
          variant={isBiometricVerified ? "outline" : "primary"}
        />
      ) : null}
      {isBiometricVerified ? (
        <Text style={stepStyles.biometricVerifiedText} testID="transfer-step-up-biometric-verified">
          Đã ký xác nhận sinh trắc học trên thiết bị. Nhấn &quot;Gửi giao dịch&quot; bên dưới để hoàn tất.
        </Text>
      ) : null}
      {canUseBiometric && !shouldShowTotpInput ? (
        <Button
          disabled={isSubmitting || Boolean(manualReviewCode)}
          label="Hoặc nhập mã TOTP 6 số"
          onPress={() => setShowTotpFallback(true)}
          testID="transfer-step-up-toggle-totp"
          variant="ghost"
        />
      ) : null}
      {shouldShowTotpInput ? (
        <TextField
          accessibilityLabel="Mã xác thực bước hai"
          autoCapitalize="none"
          editable={!manualReviewCode}
          error={error}
          label="Mã TOTP"
          onChangeText={onChangeProof}
          placeholder="000000"
          secureTextEntry
          testID="transfer-step-up-code"
          value={stepUpMethod === "BIOMETRIC" ? "" : stepUpProof}
        />
      ) : null}
      {manualReviewCode ? (
        <Text style={stepStyles.errorText}>
          Mã đối soát: {manualReviewCode}
        </Text>
      ) : null}
      {error ? (
        isTotpError ? (
          <TotpRequiredNotice
            actionLabel="Thiết lập mã TOTP ngay"
            message={error}
            testID="transfer-stepup-totp-notice"
          />
        ) : (
          <Text style={stepStyles.errorText}>{error}</Text>
        )
      ) : null}
      {isTransferChallengeUnavailable ? (
        <PrimaryButton
          disabled={isSubmitting || Boolean(manualReviewCode)}
          label={
            manualReviewCode
              ? "Đang chờ đối soát"
              : isSubmitting
                ? "Đang tạo lại..."
                : "Tạo mã xác thực mới"
          }
          onPress={onRenewChallenge}
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
                ? "Mã xác thực đã hết hạn"
                : "Gửi giao dịch"
        }
        onPress={onSubmitTransfer}
        testID="transfer-submit"
      />
    </View>
  );
}

export function TransferResultStep({
  receipt,
  statusLabel,
  recoveryTransferId,
  isSubmitting,
  onRefreshStatus,
  onGoHome,
}: {
  receipt: TransferReceipt | null;
  statusLabel: string;
  recoveryTransferId: string | null;
  isSubmitting: boolean;
  onRefreshStatus: () => void;
  onGoHome: () => void;
}) {
  return (
    <View style={stepStyles.formCard}>
      <Text style={stepStyles.stepTitle}>Kết quả giao dịch</Text>
      <Text style={stepStyles.resultTitle} testID="transfer-result-status">
        {statusLabel}
      </Text>
      <Text style={stepStyles.description}>
        Mã tham chiếu: {receipt?.reference ?? "—"}
      </Text>
      <Text style={stepStyles.description}>
        {receipt?.status === "PENDING"
          ? "Đang đối soát qua hệ thống NAPAS 24/7. Trạng thái sẽ tự động cập nhật."
          : receipt?.status === "REVERSED"
            ? "Giao dịch không thành công ở ngân hàng nhận; số tiền giữ tạm đã được hoàn trả về số dư khả dụng."
            : "Nếu giao dịch đang xử lý, bạn có thể cập nhật tại đây hoặc kiểm tra lại trong lịch sử."}
      </Text>
      {receipt?.status === "PENDING" || (!receipt && recoveryTransferId) ? (
        <PrimaryButton
          disabled={isSubmitting}
          label={isSubmitting ? "Đang cập nhật..." : "Cập nhật trạng thái"}
          onPress={onRefreshStatus}
          testID="transfer-status-refresh"
        />
      ) : null}
      <PrimaryButton disabled={isSubmitting} label="Về trang chủ" onPress={onGoHome} />
    </View>
  );
}

export const stepStyles = StyleSheet.create({
  description: {
    ...typography.body,
    color: colors.muted,
  },
  formCard: {
    gap: spacing.md,
    padding: spacing.mlg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  stepTitle: {
    ...typography.heading,
    color: colors.text,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  summaryLabel: {
    ...typography.body,
    color: colors.muted,
  },
  summaryValue: {
    flex: 1,
    ...typography.bodyStrong,
    color: colors.text,
    textAlign: "right",
  },
  reviewCard: {
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  totalLabel: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  totalValue: {
    flex: 1,
    ...typography.subheading,
    color: colors.primary,
    textAlign: "right",
  },
  errorText: {
    ...typography.body,
    padding: spacing.smd,
    borderRadius: radius.sm,
    color: colors.danger,
    backgroundColor: colors.dangerSoft,
  },
  biometricVerifiedText: {
    ...typography.body,
    padding: spacing.smd,
    borderRadius: radius.sm,
    color: colors.success,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.success,
  },
  resultTitle: {
    ...typography.title,
    color: colors.text,
  },
  beneficiaryBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  beneficiaryIconBlock: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  beneficiaryNameLabel: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  beneficiarySubLabel: {
    ...typography.caption,
    color: colors.muted,
    marginTop: 2,
  },
  amountPreviewBox: {
    padding: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: radius.sm,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  amountFormattedText: {
    ...typography.subheading,
    color: colors.primary,
  },
  amountWordsText: {
    ...typography.caption,
    color: colors.muted,
    fontStyle: "italic",
    marginTop: 2,
  },
  quickAmountContainer: {
    gap: spacing.xs,
  },
  quickAmountTitle: {
    ...typography.caption,
    color: colors.muted,
  },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  chipButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipPressed: {
    opacity: 0.7,
    backgroundColor: colors.border,
  },
  chipText: {
    ...typography.caption,
    color: colors.text,
    fontWeight: "500",
  },
  allBalanceChip: {
    borderColor: colors.primary,
  },
  allBalanceText: {
    color: colors.primary,
    fontWeight: "600",
  },
  anomalyBox: {
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  anomalyBoxWarning: {
    borderColor: colors.warning,
    backgroundColor: colors.warningSoft,
  },
  anomalyBoxDanger: {
    borderColor: colors.danger,
    backgroundColor: colors.dangerSoft,
  },
  anomalyHeader: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.xs,
  },
  anomalyTitle: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  anomalySummary: {
    ...typography.caption,
    color: colors.text,
    fontWeight: "600",
  },
  anomalyFlagText: {
    ...typography.caption,
    color: colors.muted,
  },
  confirmRiskRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    marginTop: spacing.xs,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  confirmRiskCheckbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.danger,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  confirmRiskCheckboxChecked: {
    backgroundColor: colors.danger,
  },
  confirmRiskLabel: {
    flex: 1,
    ...typography.caption,
    color: colors.text,
    fontWeight: "600",
  },
  railRow: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  railButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  railButtonSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  railButtonText: {
    ...typography.caption,
    color: colors.muted,
    fontWeight: "600",
    textAlign: "center",
  },
  railButtonTextSelected: {
    color: colors.primary,
  },
});
