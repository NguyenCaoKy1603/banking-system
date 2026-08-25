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

/**
 * Returns a cryptographic device assertion only when a future server/provider
 * supplies one. A local biometric prompt by itself is deliberately not sent
 * as an authentication proof.
 */
export function getDeviceBoundAssertion(): string {
  return process.env.EXPO_PUBLIC_DEVICE_ASSERTION?.trim() ?? "";
}
