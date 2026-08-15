import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

const DEVICE_ID_KEY = "banking.device.binding.v1";
const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

let deviceIdPromise: Promise<string> | null = null;

function isDeviceId(value: string | null): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function loadDeviceBindingId(): Promise<string> {
  if (deviceIdPromise) {
    return deviceIdPromise;
  }

  deviceIdPromise = (async () => {
    const storedValue = await SecureStore.getItemAsync(
      DEVICE_ID_KEY,
      SECURE_STORE_OPTIONS,
    );

    if (isDeviceId(storedValue)) {
      return storedValue;
    }

    const deviceId = Crypto.randomUUID();
    await SecureStore.setItemAsync(
      DEVICE_ID_KEY,
      deviceId,
      SECURE_STORE_OPTIONS,
    );
    return deviceId;
  })().catch((error: unknown) => {
    deviceIdPromise = null;
    throw error;
  });

  return deviceIdPromise;
}

export function resetDeviceBindingCacheForTests(): void {
  deviceIdPromise = null;
}
