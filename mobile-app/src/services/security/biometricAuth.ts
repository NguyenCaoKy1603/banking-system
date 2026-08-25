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
 * A local biometric prompt is not an authentication proof for the backend.
 *
 * Until a real device-attestation/passkey provider is integrated, return no
 * proof so callers fail closed instead of reading a shared value from the
 * public JavaScript bundle.
 */
export function getDeviceBoundAssertion(): string {
  return "";
}
