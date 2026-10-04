import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import {
  loadDeviceBindingId,
  resetDeviceBindingCacheForTests,
} from "@/features/auth/storage/deviceBindingStorage";

jest.mock("expo-crypto", () => ({ randomUUID: jest.fn() }));
jest.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));

const getItemAsyncMock = jest.mocked(SecureStore.getItemAsync);
const setItemAsyncMock = jest.mocked(SecureStore.setItemAsync);
const randomUUIDMock = jest.mocked(Crypto.randomUUID);
const originalPlatformOSDescriptor = Object.getOwnPropertyDescriptor(
  Platform,
  "OS",
);

function setPlatformOSForTest(os: "web" | "ios"): void {
  Object.defineProperty(Platform, "OS", { configurable: true, value: os });
}

function restorePlatformOSForTest(): void {
  if (originalPlatformOSDescriptor) {
    Object.defineProperty(Platform, "OS", originalPlatformOSDescriptor);
  }
}

beforeEach(() => {
  resetDeviceBindingCacheForTests();
  jest.resetAllMocks();
  getItemAsyncMock.mockResolvedValue(null);
  setItemAsyncMock.mockResolvedValue(undefined);
  randomUUIDMock.mockReturnValue("00000000-0000-4000-8000-000000000001");
});

afterEach(() => {
  restorePlatformOSForTest();
});

describe("deviceBindingStorage", () => {
  it("creates and persists one cryptographically generated installation id", async () => {
    await expect(loadDeviceBindingId()).resolves.toBe(
      "00000000-0000-4000-8000-000000000001",
    );
    expect(setItemAsyncMock).toHaveBeenCalledTimes(1);
    await loadDeviceBindingId();
    expect(randomUUIDMock).toHaveBeenCalledTimes(1);
  });

  it("restores a valid stored installation id", async () => {
    getItemAsyncMock.mockResolvedValueOnce(
      "00000000-0000-4000-8000-000000000002",
    );

    await expect(loadDeviceBindingId()).resolves.toBe(
      "00000000-0000-4000-8000-000000000002",
    );
    expect(setItemAsyncMock).not.toHaveBeenCalled();
  });

  it("keeps the Web installation id in memory without using SecureStore", async () => {
    setPlatformOSForTest("web");

    const firstId = await loadDeviceBindingId();
    const secondId = await loadDeviceBindingId();

    expect(firstId).toBe("00000000-0000-4000-8000-000000000001");
    expect(secondId).toBe(firstId);
    expect(randomUUIDMock).toHaveBeenCalledTimes(1);
    expect(getItemAsyncMock).not.toHaveBeenCalled();
    expect(setItemAsyncMock).not.toHaveBeenCalled();
  });
});
