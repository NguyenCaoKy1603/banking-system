import type { KycApplication, KycDraft } from "@/features/kyc/types/kyc";
import { isKycApplicationResponse } from "@/features/kyc/validation/kycResponseValidators";
import { requestJson, type RequestAuth } from "@/services/api/httpClient";

export type KycWriteOptions = {
  includeIdentityNumber?: boolean;
};

type KycWriteRequest = Omit<KycDraft, "identityNumber"> & {
  identityNumber?: string;
};

export function requireDraft(
  draft: KycDraft,
  options: KycWriteOptions = {},
): KycWriteRequest {
  const request: KycWriteRequest = {
    fullName: draft.fullName.trim(),
    address: draft.address.trim(),
    documentUri: draft.documentUri.trim(),
    syntheticDataConfirmed: draft.syntheticDataConfirmed,
  };
  const trimmedIdentity = draft.identityNumber.trim();
  if (
    options.includeIdentityNumber !== false &&
    trimmedIdentity.length > 0 &&
    !trimmedIdentity.includes("•")
  ) {
    request.identityNumber = trimmedIdentity;
  }
  return request;
}

export function getKycApplication(auth: RequestAuth): Promise<KycApplication | null> {
  return requestJson<{ application: KycApplication | null }>(
    "/kyc/application",
    { auth },
    isKycApplicationResponse,
  ).then((response) => response.application);
}

export function saveKycDraft(
  draft: KycDraft,
  auth: RequestAuth,
  options: KycWriteOptions = {},
): Promise<KycApplication> {
  return requestJson<{ application: KycApplication }>(
    "/kyc/application",
    { method: "POST", body: requireDraft(draft, options), auth },
    (value): value is { application: KycApplication } => isKycApplicationResponse(value) && value.application !== null,
  ).then((response) => response.application);
}

export function submitKycApplication(
  draft: KycDraft,
  auth: RequestAuth,
  options: KycWriteOptions = {},
): Promise<KycApplication> {
  return requestJson<{ application: KycApplication }>(
    "/kyc/application/submit",
    { method: "POST", body: requireDraft(draft, options), auth },
    (value): value is { application: KycApplication } => isKycApplicationResponse(value) && value.application !== null,
  ).then((response) => response.application);
}

export const kycApi = { getKycApplication, saveKycDraft, submitKycApplication };
