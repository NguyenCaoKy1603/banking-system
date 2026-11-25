import type {
  LoginFieldErrors,
  LoginFormValues,
  RegisterFieldErrors,
  RegisterFormValues,
} from "@/features/auth/types/auth";

type ValidationResult<Values, Errors> = {
  values: Values;
  errors: Errors;
  isValid: boolean;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_NUMBER_PATTERN = /^(?:0|\+84)\d{9}$/;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizePhoneNumber(phoneNumber: string) {
  return phoneNumber.replace(/[\s-]/g, "");
}

export function validateLoginForm(
  input: LoginFormValues,
): ValidationResult<LoginFormValues, LoginFieldErrors> {
  const values: LoginFormValues = {
    email: normalizeEmail(input.email),
    password: input.password,
  };
  const errors: LoginFieldErrors = {};

  if (!values.email) {
    errors.email = "Email là bắt buộc.";
  } else if (!EMAIL_PATTERN.test(values.email)) {
    errors.email = "Email không đúng định dạng.";
  }

  if (!values.password) {
    errors.password = "Mật khẩu là bắt buộc.";
  }

  return {
    values,
    errors,
    isValid: Object.keys(errors).length === 0,
  };
}

export function validateRegisterForm(
  input: RegisterFormValues,
): ValidationResult<RegisterFormValues, RegisterFieldErrors> {
  const values: RegisterFormValues = {
    fullName: input.fullName.trim(),
    email: normalizeEmail(input.email),
    phoneNumber: normalizePhoneNumber(input.phoneNumber),
    password: input.password,
    confirmPassword: input.confirmPassword,
  };
  const errors: RegisterFieldErrors = {};

  if (!values.fullName) {
    errors.fullName = "Họ và tên là bắt buộc.";
  } else if (values.fullName.length < 2 || values.fullName.length > 100) {
    errors.fullName = "Họ và tên phải có từ 2 đến 100 ký tự.";
  }

  if (!values.email) {
    errors.email = "Email là bắt buộc.";
  } else if (!EMAIL_PATTERN.test(values.email)) {
    errors.email = "Email không đúng định dạng.";
  }

  if (!values.phoneNumber) {
    errors.phoneNumber = "Số điện thoại là bắt buộc.";
  } else if (!PHONE_NUMBER_PATTERN.test(values.phoneNumber)) {
    errors.phoneNumber = "Số điện thoại phải có dạng 0xxxxxxxxx hoặc +84xxxxxxxxx.";
  }

  if (!values.password) {
    errors.password = "Mật khẩu là bắt buộc.";
  } else if (values.password.length < 8 || values.password.length > 64) {
    errors.password = "Mật khẩu phải có từ 8 đến 64 ký tự.";
  } else if (
    !/[a-z]/.test(values.password) ||
    !/[A-Z]/.test(values.password) ||
    !/\d/.test(values.password)
  ) {
    errors.password = "Mật khẩu cần có chữ thường, chữ hoa và chữ số.";
  }

  if (!values.confirmPassword) {
    errors.confirmPassword = "Xác nhận mật khẩu là bắt buộc.";
  } else if (values.confirmPassword !== values.password) {
    errors.confirmPassword = "Xác nhận mật khẩu không khớp.";
  }

  return {
    values,
    errors,
    isValid: Object.keys(errors).length === 0,
  };
}

export function validateStrongPasswordPolicy(password: string): string | undefined {
  if (!password) {
    return "Mật khẩu mới là bắt buộc.";
  }
  if (password.length < 12 || password.length > 128) {
    return "Mật khẩu mới phải có từ 12 đến 128 ký tự.";
  }
  if (
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/\d/.test(password) ||
    !/[^A-Za-z0-9]/.test(password)
  ) {
    return "Mật khẩu mới cần chứa chữ thường, chữ hoa, chữ số và ký tự đặc biệt.";
  }
  return undefined;
}

export type ChangePasswordFormValues = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

export type ChangePasswordFieldErrors = Partial<Record<keyof ChangePasswordFormValues, string>>;

export function validateChangePasswordForm(
  input: ChangePasswordFormValues,
): ValidationResult<ChangePasswordFormValues, ChangePasswordFieldErrors> {
  const values: ChangePasswordFormValues = {
    currentPassword: input.currentPassword,
    newPassword: input.newPassword,
    confirmPassword: input.confirmPassword,
  };
  const errors: ChangePasswordFieldErrors = {};

  if (!values.currentPassword) {
    errors.currentPassword = "Mật khẩu hiện tại là bắt buộc.";
  }

  const strengthError = validateStrongPasswordPolicy(values.newPassword);
  if (strengthError) {
    errors.newPassword = strengthError;
  } else if (values.newPassword === values.currentPassword) {
    errors.newPassword = "Mật khẩu mới phải khác mật khẩu hiện tại.";
  }

  if (!values.confirmPassword) {
    errors.confirmPassword = "Xác nhận mật khẩu mới là bắt buộc.";
  } else if (values.confirmPassword !== values.newPassword) {
    errors.confirmPassword = "Xác nhận mật khẩu mới không khớp.";
  }

  return {
    values,
    errors,
    isValid: Object.keys(errors).length === 0,
  };
}

export function validateForgotPasswordEmail(email: string): {
  normalizedEmail: string;
  error?: string;
} {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return { normalizedEmail, error: "Email là bắt buộc." };
  }
  if (!EMAIL_PATTERN.test(normalizedEmail)) {
    return { normalizedEmail, error: "Email không đúng định dạng." };
  }
  return { normalizedEmail };
}

export type ResetPasswordFormValues = {
  otpCode: string;
  newPassword: string;
  confirmPassword: string;
};

export type ResetPasswordFieldErrors = Partial<Record<keyof ResetPasswordFormValues, string>>;

export function validateResetPasswordForm(
  input: ResetPasswordFormValues,
): ValidationResult<ResetPasswordFormValues, ResetPasswordFieldErrors> {
  const values: ResetPasswordFormValues = {
    otpCode: input.otpCode.trim(),
    newPassword: input.newPassword,
    confirmPassword: input.confirmPassword,
  };
  const errors: ResetPasswordFieldErrors = {};

  if (!/^\d{6}$/.test(values.otpCode)) {
    errors.otpCode = "Mã OTP email phải gồm đúng 6 chữ số.";
  }

  const strengthError = validateStrongPasswordPolicy(values.newPassword);
  if (strengthError) {
    errors.newPassword = strengthError;
  }

  if (!values.confirmPassword) {
    errors.confirmPassword = "Xác nhận mật khẩu mới là bắt buộc.";
  } else if (values.confirmPassword !== values.newPassword) {
    errors.confirmPassword = "Xác nhận mật khẩu mới không khớp.";
  }

  return {
    values,
    errors,
    isValid: Object.keys(errors).length === 0,
  };
}
