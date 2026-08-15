/* eslint-disable @typescript-eslint/no-require-imports */

type ExpoModulesCore = {
  installModules?: () => void;
};

type RuntimeGlobals = typeof globalThis & {
  expo?: unknown;
  __turboModuleProxy?: (name: string) => ExpoModulesCore | null;
  nativeModuleProxy?: Record<string, ExpoModulesCore | undefined>;
};

export function initializeNativeRuntime(): void {
  const runtime = globalThis as RuntimeGlobals;

  if (!runtime.__turboModuleProxy && runtime.nativeModuleProxy) {
    const nativeModuleProxy = runtime.nativeModuleProxy;
    runtime.__turboModuleProxy = (name) => nativeModuleProxy[name] ?? null;
  }

  if (!runtime.expo) {
    try {
      runtime.__turboModuleProxy?.('ExpoModulesCore')?.installModules?.();
    } catch {
      // The fallback below handles hosts that expose the bridgeless proxy late.
    }
  }

  if (!runtime.expo) {
    const { installExpoGlobalPolyfill } = require(
      'expo-modules-core/src/polyfill/dangerous-internal',
    ) as {
      installExpoGlobalPolyfill: () => void;
    };
    installExpoGlobalPolyfill();
  }

  require('react-native/Libraries/Core/InitializeCore');
}
