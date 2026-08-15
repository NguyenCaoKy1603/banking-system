export type KycStatus = "DRAFT" | "PENDING" | "APPROVED" | "REJECTED";

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
};

export type KycDraft = {
  fullName: string;
  identityNumber: string;
  address: string;
  documentUri: string;
};
