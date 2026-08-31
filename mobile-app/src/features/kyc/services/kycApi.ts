import type { KycApplication, KycDraft } from "@/features/kyc/types/kyc";
import { isKycApplicationResponse } from "@/features/kyc/validation/kycResponseValidators";
import { requestJson, type RequestAuth } from "@/services/api/httpClient";

function requireDraft(draft: KycDraft): KycDraft {
  return {
    fullName: draft.fullName.trim(),
    identityNumber: draft.identityNumber.trim(),
    address: draft.address.trim(),
    documentUri: draft.documentUri.trim(),
    syntheticDataConfirmed: draft.syntheticDataConfirmed,
  };
}

export function getKycApplication(auth: RequestAuth): Promise<KycApplication | null> {
  return requestJson<{ application: KycApplication | null }>(
    "/kyc/application",
    { auth },
    isKycApplicationResponse,
  ).then((response) => response.application);
}

export function saveKycDraft(draft: KycDraft, auth: RequestAuth): Promise<KycApplication> {
  return requestJson<{ application: KycApplication }>(
    "/kyc/application",
    { method: "POST", body: requireDraft(draft), auth },
    (value): value is { application: KycApplication } => isKycApplicationResponse(value) && value.application !== null,
  ).then((response) => response.application);
}

export function submitKycApplication(draft: KycDraft, auth: RequestAuth): Promise<KycApplication> {
  return requestJson<{ application: KycApplication }>(
    "/kyc/application/submit",
    { method: "POST", body: requireDraft(draft), auth },
    (value): value is { application: KycApplication } => isKycApplicationResponse(value) && value.application !== null,
  ).then((response) => response.application);
}

export const kycApi = { getKycApplication, saveKycDraft, submitKycApplication };
