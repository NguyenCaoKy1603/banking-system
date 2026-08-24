import type { KycApplication, KycDraft } from "@/features/kyc/types/kyc";

const applications = new Map<string, KycApplication>();

function createId(): string {
  return `kyc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function now(): string {
  return new Date().toISOString();
}

export async function getMockKycApplication(
  userId: string,
): Promise<KycApplication | null> {
  return applications.get(userId) ?? null;
}

export async function submitMockKycApplication(
  userId: string,
  draft: KycDraft,
): Promise<KycApplication> {
  const timestamp = now();
  const previous = applications.get(userId);
  const application: KycApplication = {
    id: previous?.id ?? createId(),
    userId,
    fullName: draft.fullName.trim(),
    identityNumber: draft.identityNumber.trim(),
    address: draft.address.trim(),
    documentUri: draft.documentUri.trim(),
    status: "PENDING",
    rejectionReason: null,
    submittedAt: timestamp,
    updatedAt: timestamp,
  };

  applications.set(userId, application);
  return application;
}

export function resetMockKycStore(): void {
  applications.clear();
}
