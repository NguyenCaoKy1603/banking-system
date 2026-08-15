import { initializeNativeRuntime } from "./src/runtime/nativeBootstrap";

initializeNativeRuntime();

// Keep the Expo runtime as the first shared entry side effect after the native
// bridgeless bootstrap. The native-only bootstrap is selected by Metro per platform.
require('@expo/metro-runtime');

const { App } = require('expo-router/build/qualified-entry') as {
  App: (props: Record<string, never>) => unknown;
};
const { renderRootComponent } = require('expo-router/build/renderRootComponent') as {
  renderRootComponent: (component: (props: Record<string, never>) => unknown) => void;
};

renderRootComponent(App);
