import {
  isKycApplication,
  isKycApplicationResponse,
} from "@/features/kyc/validation/kycResponseValidators";

const validApplication = {
  id: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  fullName: "Synthetic Applicant",
  identityNumberLast4: "8901",
  address: "Synthetic address fixture",
  documentUri: "synthetic://document/fixture-001",
  status: "DRAFT",
  rejectionReason: null,
  submittedAt: null,
  updatedAt: "2026-09-02T00:00:00.000Z",
  version: 1,
} as const;

describe("KYC response validators", () => {
  it("accepts only the canonical four-digit last4 response field", () => {
    expect(isKycApplication(validApplication)).toBe(true);
    expect(isKycApplicationResponse({ application: validApplication })).toBe(true);
    expect(isKycApplicationResponse({ application: null })).toBe(true);
  });

  it("rejects a full identity response or a non-four-digit last4", () => {
    const withFullIdentity = {
      ...validApplication,
      identityNumber: "123456789012",
    };
    const withShortLast4 = { ...validApplication, identityNumberLast4: "901" };
    const withLongLast4 = { ...validApplication, identityNumberLast4: "78901" };

    expect(isKycApplication(withFullIdentity)).toBe(false);
    expect(isKycApplication(withShortLast4)).toBe(false);
    expect(isKycApplication(withLongLast4)).toBe(false);
  });

  it("requires an integer version matching the OpenAPI minimum", () => {
    const { version: _version, ...withoutVersion } = validApplication;

    expect(isKycApplication(withoutVersion)).toBe(false);
    expect(isKycApplication({ ...validApplication, version: "1" })).toBe(false);
    expect(isKycApplication({ ...validApplication, version: 1.5 })).toBe(false);
    expect(isKycApplication({ ...validApplication, version: 0 })).toBe(false);
    expect(isKycApplication({ ...validApplication, version: 1 })).toBe(true);
  });

  it("T-KYC-VAL-GAP-01: rejects an application response with an invalid status enum", () => {
    expect(isKycApplication({ ...validApplication, status: "PENDING" })).toBe(false);
    expect(isKycApplication({ ...validApplication, status: "UNKNOWN" })).toBe(false);
    expect(isKycApplication({ ...validApplication, status: "IN_PROGRESS" })).toBe(false);
  });

  it("T-KYC-VAL-GAP-02: rejects an application response missing required fields userId or updatedAt", () => {
    const { userId: _userId, ...withoutUserId } = validApplication;
    expect(isKycApplication(withoutUserId)).toBe(false);

    const { updatedAt: _updatedAt, ...withoutUpdatedAt } = validApplication;
    expect(isKycApplication(withoutUpdatedAt)).toBe(false);
  });
});
