export type KycStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "NEEDS_MORE_INFO"
  | "APPROVED"
  | "REJECTED";

export type KycApplication = {
  id: string;
  userId: string;
  fullName: string;
  identityNumber: string;
  address: string;
  documentUri: string;
  status: KycStatus;
  rejectionReason: string | null;
  submittedAt: string | null;
  updatedAt: string;
  version?: number;
};

export type KycDraft = {
  fullName: string;
  identityNumber: string;
  address: string;
  documentUri: string;
  syntheticDataConfirmed: boolean;
};
