import * as LocalAuthentication from "expo-local-authentication";

export async function requestBiometricAuthentication(
  promptMessage: string,
): Promise<void> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  const isEnrolled = hasHardware
    ? await LocalAuthentication.isEnrolledAsync()
    : false;

  if (!hasHardware || !isEnrolled) {
    throw new Error("Thiết bị chưa sẵn sàng cho xác thực sinh trắc học.");
  }

  const result = await LocalAuthentication.authenticateAsync({
    cancelLabel: "Hủy",
    promptMessage,
  });

  if (!result.success) {
    throw new Error("Xác thực sinh trắc học chưa thành công.");
  }
}

export function getSandboxBiometricProof(): string {
  if (process.env.NODE_ENV === "production") {
    return "";
  }
  return (
    process.env.EXPO_PUBLIC_SANDBOX_BIOMETRIC_PROOF ??
    (process.env.NODE_ENV === "development" ? "sandbox-biometric" : "")
  );
}
