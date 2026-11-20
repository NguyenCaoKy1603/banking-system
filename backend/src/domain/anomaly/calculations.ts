import type {
  AnomalyFlag,
  AnomalyRiskLevel,
  EvaluateTransferAnomalyInput,
  TransferAnomalyAssessment,
} from "./types.js";

const VIETNAM_TIME_OFFSET_MS = 7 * 60 * 60 * 1000;

export const HIGH_VALUE_THRESHOLD_MINOR = 3_500_000n;
export const NEW_RECIPIENT_HIGH_AMOUNT_THRESHOLD_MINOR = 3_000_000n;
export const LARGE_BALANCE_DRAIN_MIN_AMOUNT_MINOR = 1_000_000n;
export const LARGE_BALANCE_DRAIN_PERCENT = 80n;
export const VELOCITY_SPIKE_COUNT_THRESHOLD = 3;
export const RAPID_REPEATED_RECIPIENT_THRESHOLD = 1;
export const UNUSUAL_NIGHT_MIN_AMOUNT_MINOR = 3_000_000n;

function formatVndInteger(amountMinor: bigint): string {
  return amountMinor.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function resolveVietnamHour(isoTimestamp: string): number {
  const epochMs = Date.parse(isoTimestamp);
  const safeMs = Number.isFinite(epochMs) ? epochMs : Date.now();
  return new Date(safeMs + VIETNAM_TIME_OFFSET_MS).getUTCHours();
}

function classifyRiskLevel(riskScore: number): AnomalyRiskLevel {
  if (riskScore >= 75) return "CRITICAL";
  if (riskScore >= 55) return "HIGH";
  if (riskScore >= 25) return "MEDIUM";
  return "LOW";
}

function buildSummary(riskLevel: AnomalyRiskLevel, flags: readonly AnomalyFlag[]): string {
  if (flags.length === 0 || riskLevel === "LOW") {
    return "Giao dịch nằm trong ngưỡng hoạt động bình thường.";
  }
  const titles = flags.map((flag) => flag.title).join(", ");
  if (riskLevel === "CRITICAL") {
    return `Phát hiện dấu hiệu bất thường nghiêm trọng: ${titles}.`;
  }
  if (riskLevel === "HIGH") {
    return `Cảnh báo giao dịch bất thường mức cao: ${titles}.`;
  }
  return `Giao dịch có dấu hiệu cần lưu ý: ${titles}.`;
}

/**
 * Evaluates a transfer against deterministic, BigInt-safe anomaly detection rules.
 */
export function evaluateTransferAnomaly(
  input: EvaluateTransferAnomalyInput,
): TransferAnomalyAssessment {
  const flags: AnomalyFlag[] = [];
  const totalDebitMinor = input.amountMinor + input.feeMinor;

  if (input.amountMinor >= HIGH_VALUE_THRESHOLD_MINOR) {
    flags.push({
      code: "HIGH_VALUE_TRANSFER",
      title: "Giao dịch giá trị lớn",
      detail: `Số tiền chuyển ${formatVndInteger(input.amountMinor)} VND vượt ngưỡng cảnh báo ${formatVndInteger(HIGH_VALUE_THRESHOLD_MINOR)} VND.`,
      weight: 35,
    });
  }

  if (
    input.amountMinor >= LARGE_BALANCE_DRAIN_MIN_AMOUNT_MINOR &&
    input.availableBalanceMinor > 0n &&
    (totalDebitMinor * 100n) / input.availableBalanceMinor >= LARGE_BALANCE_DRAIN_PERCENT
  ) {
    const drainPercent = Number((totalDebitMinor * 100n) / input.availableBalanceMinor);
    flags.push({
      code: "LARGE_BALANCE_DRAIN",
      title: "Rút tỷ lệ lớn số dư khả dụng",
      detail: `Giao dịch sử dụng khoảng ${Math.min(100, drainPercent)}% số dư khả dụng hiện tại của tài khoản nguồn.`,
      weight: 30,
    });
  }

  if (input.isNewRecipient && input.amountMinor >= NEW_RECIPIENT_HIGH_AMOUNT_THRESHOLD_MINOR) {
    flags.push({
      code: "NEW_RECIPIENT_HIGH_AMOUNT",
      title: "Chuyển khoản lớn cho người nhận mới",
      detail: `Chuyển ${formatVndInteger(input.amountMinor)} VND đến người nhận chưa có trong danh bạ hoặc chưa từng giao dịch trước đó.`,
      weight: 30,
    });
  }

  if (input.recentTransfersLast10mCount >= VELOCITY_SPIKE_COUNT_THRESHOLD) {
    flags.push({
      code: "VELOCITY_SPIKE",
      title: "Tần suất chuyển tiền cao bất thường",
      detail: `Đã phát sinh ${input.recentTransfersLast10mCount} giao dịch chuyển tiền trong 10 phút gần nhất.`,
      weight: 40,
    });
  }

  if (input.sameRecipientLast15mCount >= RAPID_REPEATED_RECIPIENT_THRESHOLD) {
    flags.push({
      code: "RAPID_REPEATED_RECIPIENT",
      title: "Chuyển lặp lại cho cùng một người nhận",
      detail: `Đã có ${input.sameRecipientLast15mCount} giao dịch tới cùng tài khoản thụ hưởng trong 15 phút vừa qua.`,
      weight: 35,
    });
  }

  const vietnamHour = resolveVietnamHour(input.occurredAt);
  if (input.amountMinor >= UNUSUAL_NIGHT_MIN_AMOUNT_MINOR && vietnamHour >= 0 && vietnamHour <= 4) {
    flags.push({
      code: "UNUSUAL_NIGHT_HOUR",
      title: "Giao dịch giá trị lớn vào ban đêm",
      detail: `Giao dịch phát sinh lúc ${String(vietnamHour).padStart(2, "0")}:00 (giờ Việt Nam) trong khung giờ 00:00–05:00.`,
      weight: 25,
    });
  }

  const rawScore = flags.reduce((sum, flag) => sum + flag.weight, 0);
  const riskScore = Math.min(100, rawScore);
  const riskLevel = classifyRiskLevel(riskScore);
  const flagged = riskLevel !== "LOW";

  return {
    riskLevel,
    riskScore,
    flagged,
    requiresConfirmation: riskLevel === "HIGH" || riskLevel === "CRITICAL",
    summary: buildSummary(riskLevel, flags),
    flags,
    evaluatedAt: input.occurredAt,
  };
}
