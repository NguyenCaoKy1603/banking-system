import type { KycDraft } from "@/features/kyc/types/kyc";

export type KycFieldErrors = Partial<Record<keyof KycDraft, string>>;

export type KycValidationOptions = {
  identityRequired?: boolean;
};

export function validateKycDraft(
  draft: KycDraft,
  options: KycValidationOptions = {},
): KycFieldErrors {
  const errors: KycFieldErrors = {};
  const fullName = draft.fullName.trim();
  const identityNumber = draft.identityNumber.trim();
  const address = draft.address.trim();
  const identityRequired = options.identityRequired ?? true;

  if (fullName.length < 2) {
    errors.fullName = "Họ tên phải có ít nhất 2 ký tự.";
  }

  if (identityRequired) {
    if (
      identityNumber.length === 0 ||
      identityNumber.includes("•") ||
      !/^\d{6,24}$/.test(identityNumber)
    ) {
      errors.identityNumber = "Số định danh phải gồm 6–24 chữ số.";
    }
  } else {
    // When existing identity is unchanged, empty string is valid.
    // If the user enters a value, it must be 6-24 digits and not contain masked characters.
    if (
      identityNumber.length > 0 &&
      (identityNumber.includes("•") || !/^\d{6,24}$/.test(identityNumber))
    ) {
      errors.identityNumber = "Số định danh phải gồm 6–24 chữ số.";
    }
  }

  if (address.length < 5) {
    errors.address = "Địa chỉ phải có ít nhất 5 ký tự.";
  }

  if (!/^((mock|synthetic):\/\/)/.test(draft.documentUri.trim())) {
    errors.documentUri = "Cần chọn ảnh giấy tờ.";
  }

  if (draft.syntheticDataConfirmed !== true) {
    errors.syntheticDataConfirmed = "Vui lòng xác nhận không nhập thông tin cá nhân thật.";
  }

  return errors;
}

export function hasKycFieldErrors(errors: KycFieldErrors): boolean {
  return Object.keys(errors).length > 0;
}
