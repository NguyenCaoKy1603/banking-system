import type { KycDraft } from "@/features/kyc/types/kyc";

export type KycFieldErrors = Partial<Record<keyof KycDraft, string>>;

export function validateKycDraft(draft: KycDraft): KycFieldErrors {
  const errors: KycFieldErrors = {};
  const fullName = draft.fullName.trim();
  const identityNumber = draft.identityNumber.trim();
  const address = draft.address.trim();

  if (fullName.length < 2) {
    errors.fullName = "Họ tên phải có ít nhất 2 ký tự.";
  }

  if (!/^\d{9,12}$/.test(identityNumber)) {
    errors.identityNumber = "Số định danh mô phỏng gồm 9–12 chữ số.";
  }

  if (address.length < 5) {
    errors.address = "Địa chỉ phải có ít nhất 5 ký tự.";
  }

  if (!draft.documentUri.trim()) {
    errors.documentUri = "Cần chọn ảnh giấy tờ mẫu để gửi hồ sơ.";
  }

  if (!draft.syntheticDataConfirmed) {
    errors.syntheticDataConfirmed = "Cần xác nhận chỉ sử dụng dữ liệu mô phỏng, không dùng thông tin thật.";
  }

  return errors;
}

export function hasKycFieldErrors(errors: KycFieldErrors): boolean {
  return Object.keys(errors).length > 0;
}
