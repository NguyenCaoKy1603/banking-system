process.env.APP_VARIANT = "local-sandbox";
process.env.EXPO_PUBLIC_API_URL = "http://10.0.2.2:5000/api/v1";
process.env.EXPO_PUBLIC_SANDBOX_HTTP = "1";

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { extra: { runtimeEnvironment: "local-sandbox" } } },
}));

jest.mock("expo-device", () => ({
  __esModule: true,
  deviceName: "Test Phone",
  modelName: "Pixel 7",
  osName: "Android",
  osVersion: "15",
}));
