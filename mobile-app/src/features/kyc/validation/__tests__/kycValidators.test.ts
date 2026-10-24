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

  describe("context-aware identity validation", () => {
    const validBase = {
      fullName: "Synthetic Applicant",
      address: "123 Synthetic Street",
      documentUri: "mock://identity-card-front",
      syntheticDataConfirmed: true,
    };

    it("new application context (identityRequired: true): requires 6-24 digits and rejects empty, masked, or last4-only", () => {
      // Missing / empty
      expect(validateKycDraft({ ...validBase, identityNumber: "" }, { identityRequired: true }).identityNumber).toBeDefined();
      expect(validateKycDraft({ ...validBase, identityNumber: "   " }, { identityRequired: true }).identityNumber).toBeDefined();

      // Masked
      expect(validateKycDraft({ ...validBase, identityNumber: "••••9012" }, { identityRequired: true }).identityNumber).toBeDefined();

      // Last 4 only (less than 6 digits)
      expect(validateKycDraft({ ...validBase, identityNumber: "9012" }, { identityRequired: true }).identityNumber).toBeDefined();

      // Valid 6-24 digits
      expect(hasKycFieldErrors(validateKycDraft({ ...validBase, identityNumber: "123456" }, { identityRequired: true }))).toBe(false);
      expect(hasKycFieldErrors(validateKycDraft({ ...validBase, identityNumber: "123456789012" }, { identityRequired: true }))).toBe(false);
    });

    it("existing unchanged context (identityRequired: false): allows empty identity", () => {
      const errors = validateKycDraft({ ...validBase, identityNumber: "" }, { identityRequired: false });
      expect(hasKycFieldErrors(errors)).toBe(false);
      expect(errors.identityNumber).toBeUndefined();
    });

    it("existing changed context (identityRequired: false): enforces 6-24 digits and rejects masked or last4-only when entered", () => {
      // Masked input
      expect(validateKycDraft({ ...validBase, identityNumber: "••••9012" }, { identityRequired: false }).identityNumber).toBeDefined();

      // Last 4 only
      expect(validateKycDraft({ ...validBase, identityNumber: "9012" }, { identityRequired: false }).identityNumber).toBeDefined();

      // Valid full new identity
      const errors = validateKycDraft({ ...validBase, identityNumber: "987654321098" }, { identityRequired: false });
      expect(hasKycFieldErrors(errors)).toBe(false);
      expect(errors.identityNumber).toBeUndefined();
    });
  });
});
