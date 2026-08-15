export type StepUpMethod = "OTP" | "BIOMETRIC";

export type ControlPolicy = {
  configVersion: string;
  globalKillSwitch: boolean;
  transfersEnabled: boolean;
  allowlisted: boolean;
  maxTransferAmountMinor: string;
  stepUpMethods: StepUpMethod[];
  savingsEnabled: boolean;
  savingsAllowlisted: boolean;
  maxSavingsAmountMinor: string;
  savingsStepUpMethods: StepUpMethod[];
  updatedAt: string;
};
