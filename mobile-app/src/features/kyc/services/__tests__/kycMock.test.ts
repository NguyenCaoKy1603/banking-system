import * as kycMock from "@/features/kyc/services/kycMock";
import {
  getMockKycApplication,
  resetMockKycStore,
  submitMockKycApplication,
} from "@/features/kyc/services/kycMock";

describe("kycMock", () => {
  beforeEach(() => resetMockKycStore());

  it("only submits and reads a pending application in the customer client", async () => {
    const submitted = await submitMockKycApplication("user-1", {
      fullName: "Nguyễn Văn A",
      identityNumber: "012345678901",
      address: "12 Đường Mẫu, Hà Nội",
      documentUri: "mock://identity-card-front",
    });

    expect(submitted.status).toBe("PENDING");
    expect(await getMockKycApplication("user-1")).toEqual(submitted);
    expect(kycMock).not.toHaveProperty("setMockKycStatus");
  });

  it("keeps a resubmission pending instead of granting a local decision", async () => {
    const first = await submitMockKycApplication("user-2", {
      fullName: "Trần B",
      identityNumber: "123456789",
      address: "Địa chỉ mẫu",
      documentUri: "mock://identity-card-front",
    });

    const resubmitted = await submitMockKycApplication("user-2", {
      fullName: "Trần B đã cập nhật",
      identityNumber: "123456789",
      address: "Địa chỉ mẫu mới",
      documentUri: "mock://identity-card-front",
    });

    expect(resubmitted.id).toBe(first.id);
    expect(resubmitted.status).toBe("PENDING");
    expect(resubmitted.rejectionReason).toBeNull();
  });
});
