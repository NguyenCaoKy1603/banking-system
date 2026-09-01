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

  it("uses the canonical identity boundary and document URI schemes", () => {
    const base = {
      fullName: "Synthetic Applicant",
      address: "Synthetic address fixture",
      documentUri: "synthetic://document/fixture-001",
      syntheticDataConfirmed: true,
    };

    expect(hasKycFieldErrors(validateKycDraft({ ...base, identityNumber: "123456" }))).toBe(false);
    expect(hasKycFieldErrors(validateKycDraft({ ...base, identityNumber: "1".repeat(24) }))).toBe(false);
    expect(validateKycDraft({ ...base, identityNumber: "12345" }).identityNumber).toBeDefined();
    expect(validateKycDraft({ ...base, identityNumber: "123456", documentUri: "https://example.test/document" }).documentUri).toBeDefined();
  });

  it("allows an existing application update to omit an unchanged identity", () => {
    const errors = validateKycDraft({
      fullName: "Synthetic Applicant",
      identityNumber: "",
      address: "Synthetic address fixture",
      documentUri: "mock://identity-card-front",
      syntheticDataConfirmed: true,
    }, { identityRequired: false });

    expect(hasKycFieldErrors(errors)).toBe(false);
  });

  it("requires syntheticDataConfirmed to be exactly boolean true", () => {
    const base = {
      fullName: "Synthetic Applicant",
      identityNumber: "123456",
      address: "Synthetic address fixture",
      documentUri: "synthetic://document/fixture-001",
    };

    for (const value of [false, "true", 1, {}, null] as unknown[]) {
      const errors = validateKycDraft({
        ...base,
        syntheticDataConfirmed: value as boolean,
      });
      expect(errors.syntheticDataConfirmed).toBeDefined();
    }

    expect(validateKycDraft({ ...base, syntheticDataConfirmed: true }).syntheticDataConfirmed).toBeUndefined();
  });
});
