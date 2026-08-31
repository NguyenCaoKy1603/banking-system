import { hasKycFieldErrors, validateKycDraft } from "@/features/kyc/validation/kycValidators";

describe("validateKycDraft", () => {
  it("accepts a complete simulated KYC draft", () => {
    const errors = validateKycDraft({
      fullName: "Nguyễn Văn A",
      identityNumber: "012345678901",
      address: "12 Đường Mẫu, Hà Nội",
      documentUri: "mock://identity-card-front",
      syntheticDataConfirmed: true,
    });

    expect(hasKycFieldErrors(errors)).toBe(false);
  });

  it("reports identity and document errors before submit", () => {
    const errors = validateKycDraft({
      fullName: "A",
      identityNumber: "abc",
      address: "x",
      documentUri: "",
      syntheticDataConfirmed: false,
    });

    expect(errors.identityNumber).toBeDefined();
    expect(errors.documentUri).toBeDefined();
    expect(errors.syntheticDataConfirmed).toBeDefined();
    expect(hasKycFieldErrors(errors)).toBe(true);
  });
});
