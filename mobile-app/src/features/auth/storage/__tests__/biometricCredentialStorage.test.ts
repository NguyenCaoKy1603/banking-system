import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import {
  clearBiometricCredential,
  loadBiometricCredential,
  saveBiometricCredential,
} from "@/features/auth/storage/biometricCredentialStorage";
import { createSecureStoreScopedKey } from "@/features/banking/storage/secureStoreScope";

jest.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  deleteItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));

jest.mock("@/features/banking/storage/secureStoreScope", () => ({
  createSecureStoreScopedKey: jest.fn(),
}));

const getItemAsyncMock = jest.mocked(SecureStore.getItemAsync);
const setItemAsyncMock = jest.mocked(SecureStore.setItemAsync);
const deleteItemAsyncMock = jest.mocked(SecureStore.deleteItemAsync);
const createScopedKeyMock = jest.mocked(createSecureStoreScopedKey);

describe("biometricCredentialStorage", () => {
  const originalOs = Platform.OS;

  beforeEach(() => {
    jest.resetAllMocks();
    Platform.OS = "ios";
    createScopedKeyMock.mockImplementation(
      async (_prefix, userId, deviceId) =>
        `banking.biometric.v1.${userId}.${deviceId}`,
    );
  });

  afterAll(() => {
    Platform.OS = originalOs;
  });

  it("saves and loads scoped biometric credential for matching userId and deviceId", async () => {
    const record = {
      credentialId: "cred-bio-1",
      userId: "user-1",
      deviceId: "device-1",
      biometricSecret: "secret-abc",
      displayName: "Sinh trắc học thiết bị",
      enrolledAt: "2026-11-19T00:00:00.000Z",
    };

    await saveBiometricCredential(record);
    expect(setItemAsyncMock).toHaveBeenCalledWith(
      "banking.biometric.v1.user-1.device-1",
      JSON.stringify(record),
      expect.objectContaining({
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      }),
    );

    getItemAsyncMock.mockResolvedValueOnce(JSON.stringify(record));
    await expect(loadBiometricCredential("user-1", "device-1")).resolves.toEqual(
      record,
    );
  });

  it("rejects mismatched owner or device records and supports clearing", async () => {
    getItemAsyncMock.mockResolvedValueOnce(
      JSON.stringify({
        credentialId: "cred-bio-1",
        userId: "other-user",
        deviceId: "device-1",
        biometricSecret: "secret-abc",
        displayName: "Sinh trắc học",
        enrolledAt: "2026-11-19T00:00:00.000Z",
      }),
    );
    await expect(loadBiometricCredential("user-1", "device-1")).resolves.toBeNull();

    await clearBiometricCredential("user-1", "device-1");
    expect(deleteItemAsyncMock).toHaveBeenCalledWith(
      "banking.biometric.v1.user-1.device-1",
      expect.any(Object),
    );
  });
});
