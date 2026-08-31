import type { RequestAuth } from "@/services/api/httpClient";
import { requestJson } from "@/services/api/httpClient";
import type { AuthChallengeResponse } from "@/features/auth/types/auth";
import { isAuthChallengeResponse } from "@/features/auth/services/authResponseValidators";

export type OtpPurpose =
  | "REGISTRATION_VERIFY"
  | "LOGIN"
  | "TRANSFER"
  | "SAVINGS_OPENING"
  | "CREDIT_APPLICATION"
  | "CARD_ACTIVATION"
  | "CREDIT_PAYMENT"
  | "CARD_UNLOCK"
  | "CARD_REPORT_LOST";

export type CreateOtpChallengeRequest = {
  purpose: OtpPurpose;
  resourceId?: string | null;
  requestFingerprint?: string | null;
};

export function createOtpChallenge(
  request: CreateOtpChallengeRequest,
  auth: RequestAuth,
): Promise<AuthChallengeResponse> {
  return requestJson<AuthChallengeResponse>(
    "/auth/otp/challenges",
    { method: "POST", body: request, auth },
    isAuthChallengeResponse,
  );
}

export const otpApi = { createOtpChallenge };
