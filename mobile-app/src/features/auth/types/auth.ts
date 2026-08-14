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
