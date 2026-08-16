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

export type AuthChallengeMethod = "OTP" | "BIOMETRIC";

export type AuthChallengeResponse = {
  challengeId: string;
  expiresAt: string;
  methods: AuthChallengeMethod[];
  purpose?:
    | "REGISTRATION_VERIFY"
    | "LOGIN"
    | "TRANSFER"
    | "SAVINGS_OPENING"
    | "CREDIT_APPLICATION"
    | "CARD_ACTIVATION"
    | "CREDIT_PAYMENT"
    | "CARD_UNLOCK";
};

export type LoginResult = LoginResponse | AuthChallengeResponse;

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

export type RegisterResult = RegisterResponse | AuthChallengeResponse;
