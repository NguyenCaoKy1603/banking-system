import type {
  LoginFormValues,
  RegisterFormValues,
  RegisterRequest,
} from "@/features/auth/types/auth";
import {
  validateLoginForm,
  validateRegisterForm,
} from "@/features/auth/validation/authValidation";

const validLoginForm: LoginFormValues = {
  email: "tester@example.com",
  password: "x",
};

const validRegisterForm: RegisterFormValues = {
  fullName: "Người Dùng Thử",
  email: "tester@example.com",
  phoneNumber: "0912345678",
  password: "Secure123",
  confirmPassword: "Secure123",
};

describe("validateLoginForm", () => {
  it("chấp nhận dữ liệu đăng nhập hợp lệ", () => {
    const result = validateLoginForm(validLoginForm);

    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual({});
  });

  it("trim và chuyển email sang lowercase", () => {
    const result = validateLoginForm({
      ...validLoginForm,
      email: "  TESTER@EXAMPLE.COM  ",
    });

    expect(result.values.email).toBe("tester@example.com");
  });

  it("báo lỗi khi email trống", () => {
    const result = validateLoginForm({ ...validLoginForm, email: "   " });

    expect(result.isValid).toBe(false);
    expect(result.errors.email).toBeDefined();
  });

  it("báo lỗi khi email sai định dạng", () => {
    const result = validateLoginForm({
      ...validLoginForm,
      email: "email-khong-hop-le",
    });

    expect(result.isValid).toBe(false);
    expect(result.errors.email).toBeDefined();
  });

  it("báo lỗi khi mật khẩu trống", () => {
    const result = validateLoginForm({ ...validLoginForm, password: "" });

    expect(result.isValid).toBe(false);
    expect(result.errors.password).toBeDefined();
  });

  it("không áp dụng quy tắc mật khẩu đăng ký cho mật khẩu đăng nhập ngắn", () => {
    const result = validateLoginForm({ ...validLoginForm, password: "1" });

    expect(result.isValid).toBe(true);
    expect(result.errors.password).toBeUndefined();
  });
});

describe("validateRegisterForm", () => {
  it("chấp nhận form đăng ký hợp lệ", () => {
    const result = validateRegisterForm(validRegisterForm);

    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual({});
  });

  it("trim họ tên, trim email và chuyển email sang lowercase", () => {
    const result = validateRegisterForm({
      ...validRegisterForm,
      fullName: "  Người Dùng Thử  ",
      email: "  TESTER@EXAMPLE.COM  ",
    });

    expect(result.values.fullName).toBe("Người Dùng Thử");
    expect(result.values.email).toBe("tester@example.com");
  });

  it("loại bỏ khoảng trắng và dấu gạch ngang khỏi số điện thoại", () => {
    const result = validateRegisterForm({
      ...validRegisterForm,
      phoneNumber: "0912 345-678",
    });

    expect(result.isValid).toBe(true);
    expect(result.values.phoneNumber).toBe("0912345678");
  });

  it("chấp nhận số điện thoại dạng 0912345678", () => {
    const result = validateRegisterForm({
      ...validRegisterForm,
      phoneNumber: "0912345678",
    });

    expect(result.isValid).toBe(true);
    expect(result.errors.phoneNumber).toBeUndefined();
  });

  it("chấp nhận số điện thoại dạng +84912345678", () => {
    const result = validateRegisterForm({
      ...validRegisterForm,
      phoneNumber: "+84912345678",
    });

    expect(result.isValid).toBe(true);
    expect(result.errors.phoneNumber).toBeUndefined();
  });

  it("từ chối số điện thoại sai định dạng", () => {
    const result = validateRegisterForm({
      ...validRegisterForm,
      phoneNumber: "84912345678",
    });

    expect(result.isValid).toBe(false);
    expect(result.errors.phoneNumber).toBeDefined();
  });

  it("từ chối số điện thoại trống", () => {
    const result = validateRegisterForm({
      ...validRegisterForm,
      phoneNumber: "   ",
    });

    expect(result.isValid).toBe(false);
    expect(result.errors.phoneNumber).toBeDefined();
  });

  it.each([
    ["trống", "   "],
    ["quá ngắn", "A"],
    ["quá dài", "A".repeat(101)],
  ])("từ chối họ tên %s", (_caseName, fullName) => {
    const result = validateRegisterForm({ ...validRegisterForm, fullName });

    expect(result.isValid).toBe(false);
    expect(result.errors.fullName).toBeDefined();
  });

  it.each([
    ["trống", "   "],
    ["sai định dạng", "email-khong-hop-le"],
  ])("từ chối email %s", (_caseName, email) => {
    const result = validateRegisterForm({ ...validRegisterForm, email });

    expect(result.isValid).toBe(false);
    expect(result.errors.email).toBeDefined();
  });

  it("từ chối mật khẩu dưới 8 ký tự", () => {
    const result = validateRegisterForm({
      ...validRegisterForm,
      password: "Aa12345",
      confirmPassword: "Aa12345",
    });

    expect(result.isValid).toBe(false);
    expect(result.errors.password).toBeDefined();
  });

  it("từ chối mật khẩu trống", () => {
    const result = validateRegisterForm({
      ...validRegisterForm,
      password: "",
      confirmPassword: "",
    });

    expect(result.isValid).toBe(false);
    expect(result.errors.password).toBeDefined();
  });

  it("từ chối mật khẩu trên 64 ký tự", () => {
    const password = `A1${"a".repeat(63)}`;
    const result = validateRegisterForm({
      ...validRegisterForm,
      password,
      confirmPassword: password,
    });

    expect(result.isValid).toBe(false);
    expect(result.errors.password).toBeDefined();
  });

  it("từ chối mật khẩu thiếu chữ thường", () => {
    const result = validateRegisterForm({
      ...validRegisterForm,
      password: "PASSWORD1",
      confirmPassword: "PASSWORD1",
    });

    expect(result.isValid).toBe(false);
    expect(result.errors.password).toBeDefined();
  });

  it("từ chối mật khẩu thiếu chữ hoa", () => {
    const result = validateRegisterForm({
      ...validRegisterForm,
      password: "password1",
      confirmPassword: "password1",
    });

    expect(result.isValid).toBe(false);
    expect(result.errors.password).toBeDefined();
  });

  it("từ chối mật khẩu thiếu chữ số", () => {
    const result = validateRegisterForm({
      ...validRegisterForm,
      password: "Password",
      confirmPassword: "Password",
    });

    expect(result.isValid).toBe(false);
    expect(result.errors.password).toBeDefined();
  });

  it.each([
    ["trống", ""],
    ["không khớp", "Secure456"],
  ])("từ chối xác nhận mật khẩu %s", (_caseName, confirmPassword) => {
    const result = validateRegisterForm({
      ...validRegisterForm,
      confirmPassword,
    });

    expect(result.isValid).toBe(false);
    expect(result.errors.confirmPassword).toBeDefined();
  });

  it("RegisterRequest không chứa confirmPassword", () => {
    const request = {
      fullName: validRegisterForm.fullName,
      email: validRegisterForm.email,
      phoneNumber: validRegisterForm.phoneNumber,
      password: validRegisterForm.password,
    } satisfies RegisterRequest;

    expect(request).not.toHaveProperty("confirmPassword");
  });
});
