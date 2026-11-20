import type { TransactionAnomaly, TransferAnomalyAssessment } from "./types.js";

export function cloneAnomalyAssessment(
  assessment: TransferAnomalyAssessment,
): TransferAnomalyAssessment {
  return {
    ...assessment,
    flags: assessment.flags.map((flag) => ({ ...flag })),
  };
}

export function cloneTransactionAnomaly(
  record: TransactionAnomaly,
): TransactionAnomaly {
  return {
    ...record,
    amount: { ...record.amount },
    ruleCodes: [...record.ruleCodes],
    flags: record.flags.map((flag) => ({ ...flag })),
  };
}
