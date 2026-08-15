import { isControlPolicy } from "@/features/control/validation/controlPolicyValidators";

const policy = {
  configVersion: "sandbox-1",
  globalKillSwitch: false,
  transfersEnabled: true,
  allowlisted: true,
  maxTransferAmountMinor: "5000000",
  stepUpMethods: ["OTP", "BIOMETRIC"],
  savingsEnabled: true,
  savingsAllowlisted: true,
  maxSavingsAmountMinor: "500000000",
  savingsStepUpMethods: ["OTP", "BIOMETRIC"],
  updatedAt: "2026-08-14T00:00:00Z",
};

describe("control policy validator", () => {
  it("accepts a valid server policy", () => {
    expect(isControlPolicy(policy)).toBe(true);
  });

  it("rejects unsafe or malformed limits", () => {
    expect(isControlPolicy({ ...policy, maxTransferAmountMinor: "-1" })).toBe(false);
    expect(isControlPolicy({ ...policy, transfersEnabled: "true" })).toBe(false);
    expect(isControlPolicy({ ...policy, stepUpMethods: [] })).toBe(false);
    expect(isControlPolicy({ ...policy, stepUpMethods: ["PASSWORD"] })).toBe(false);
    expect(isControlPolicy({ ...policy, savingsStepUpMethods: [] })).toBe(false);
    expect(isControlPolicy({ ...policy, maxSavingsAmountMinor: "-1" })).toBe(false);
    expect(isControlPolicy({ ...policy, updatedAt: "" })).toBe(false);
  });
});
