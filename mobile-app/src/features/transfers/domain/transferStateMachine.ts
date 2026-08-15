import type { TransferStatus } from "@/features/transfers/types/transfer";

const allowedTransitions: Record<TransferStatus, readonly TransferStatus[]> = {
  PENDING: ["PENDING", "SUCCEEDED", "FAILED", "REVERSED"],
  SUCCEEDED: ["SUCCEEDED"],
  FAILED: ["FAILED"],
  REVERSED: ["REVERSED"],
};

export function canTransitionTransfer(
  current: TransferStatus,
  next: TransferStatus,
): boolean {
  return allowedTransitions[current].includes(next);
}

export function transitionTransfer(
  current: TransferStatus,
  next: TransferStatus,
): TransferStatus {
  if (!canTransitionTransfer(current, next)) {
    throw new Error(`Không thể chuyển trạng thái giao dịch từ ${current} sang ${next}.`);
  }

  return next;
}
