export type LoginFormValues = {
  email: string;
  password: string;
};

export type LoginFieldErrors = Partial<Record<keyof LoginFormValues, string>>;

export type RegisterFormValues = {
  fullName: string;
  email: string;
  phoneNumber: string;
  password: string;
  confirmPassword: string;
};

export type RegisterFieldErrors = Partial<
  Record<keyof RegisterFormValues, string>
>;

export type LoginRequest = {
  email: string;
  password: string;
};

export type RegisterRequest = {
  fullName: string;
  email: string;
  phoneNumber: string;
  password: string;
};

export type AuthUser = {
  id: string;
  fullName: string;
  email: string;
  phoneNumber: string;
  createdAt: string;
};

export type LoginResponse = {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  user: AuthUser;
};

export type AuthChallengeMethod = "OTP" | "EMAIL_OTP" | "TOTP" | "BIOMETRIC";

export type AuthChallengeResponse = {
  challengeId: string;
  expiresAt: string;
  methods: AuthChallengeMethod[];
  /** Server-selected factor; registration currently returns EMAIL_OTP. */
  method?: AuthChallengeMethod;
  /** Earliest resend time returned by the email delivery boundary. */
  resendAfter?: string;
  /** Redacted destination shown to the user; never the OTP itself. */
  maskedDestination?: string;
  purpose:
    | "REGISTRATION_VERIFY"
    | "REGISTRATION_EMAIL_VERIFY"
    | "LOGIN"
    | "TRANSFER"
    | "SAVINGS_OPENING"
    | "CREDIT_APPLICATION"
    | "CARD_ACTIVATION"
    | "CREDIT_PAYMENT"
    | "CARD_UNLOCK"
    | "CARD_REPORT_LOST"
    | "RECOVERY_CODE_ROTATION"
    | "MFA_FACTOR_CHANGE"
    | "MFA_FACTOR_REMOVAL";
};

export type VerifyAuthChallengeRequest = {
  challengeId: string;
  method: AuthChallengeMethod;
  proof: string;
};

export type RefreshTokenRequest = {
  refreshToken: string;
};

export type RefreshTokenResponse = LoginResponse;

export type LogoutRequest = {
  refreshToken: string;
};

export type RegisterResponse = {
  user: AuthUser;
};

export type MfaCredentialSummary = {
  id: string;
  customerId: string;
  credentialType: "TOTP" | "PASSKEY" | "OOB_SMS";
  displayName: string;
  status: "PENDING" | "ACTIVE" | "SUSPENDED" | "REVOKED";
  algorithm: string;
  digits: number;
  periodSeconds: number;
  lastAcceptedTimeStep: number | null;
  enrolledAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  compromisedAt: string | null;
  createdAt: string;
};

export type MfaMethodsResponse = {
  items: MfaCredentialSummary[];
};

export type TotpEnrollmentResponse = {
  credentialId: string;
  status: "PENDING";
  expiresAt: string;
  manualSetupKey: string;
  otpauthUri: string;
};

export type TotpConfirmationResponse = {
  credentialId: string;
  status: "ACTIVE";
  recoveryCodes: string[];
};

export type MfaLifecyclePurpose =
  | "RECOVERY_CODE_ROTATION"
  | "MFA_FACTOR_CHANGE"
  | "MFA_FACTOR_REMOVAL";

export type RecoveryStartedResponse = {
  status: "RECOVERY_STARTED";
  recoveryRequestId: string;
  recoveryToken: string;
  cooldownUntil: string;
};

export type RecoveryCompletedResponse = {
  status: "RECOVERY_COMPLETED";
};
