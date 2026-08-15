import {
  getMockKycApplication,
  resetMockKycStore,
  setMockKycStatus,
  submitMockKycApplication,
} from "@/features/kyc/services/kycMock";

describe("kycMock", () => {
  beforeEach(() => resetMockKycStore());

  it("submits and tracks the simulated KYC lifecycle", async () => {
    const submitted = await submitMockKycApplication("user-1", {
      fullName: "Nguyễn Văn A",
      identityNumber: "012345678901",
      address: "12 Đường Mẫu, Hà Nội",
      documentUri: "mock://identity-card-front",
    });

    expect(submitted.status).toBe("PENDING");
    expect((await setMockKycStatus("user-1", "APPROVED"))?.status).toBe("APPROVED");
    expect((await getMockKycApplication("user-1"))?.status).toBe("APPROVED");
  });

  it("keeps a rejected status with a safe demo reason", async () => {
    await submitMockKycApplication("user-2", {
      fullName: "Trần B",
      identityNumber: "123456789",
      address: "Địa chỉ mẫu",
      documentUri: "mock://identity-card-front",
    });

    const rejected = await setMockKycStatus("user-2", "REJECTED");
    expect(rejected?.status).toBe("REJECTED");
    expect(rejected?.rejectionReason).toBeTruthy();
  });
});
