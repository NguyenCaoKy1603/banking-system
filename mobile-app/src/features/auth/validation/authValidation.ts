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
