import { Platform } from "react-native";
import Constants from "expo-constants";

const DEFAULT_DEVELOPMENT_API_URL = "http://10.0.2.2:5000/api/v1";
const APP_ENVIRONMENTS = ["development", "local-sandbox", "staging", "production"] as const;
type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];

export const isProductionBuild = process.env.NODE_ENV === "production";
const allowInsecureSandboxHttp = process.env.EXPO_PUBLIC_SANDBOX_HTTP === "1";
const configuredAppEnvironment =
  Constants.expoConfig?.extra?.runtimeEnvironment ?? process.env.APP_VARIANT;

function resolveAppEnvironment(value: unknown): AppEnvironment {
  if (typeof value === "string" && APP_ENVIRONMENTS.includes(value as AppEnvironment)) {
    return value as AppEnvironment;
  }
  return isProductionBuild ? "production" : "development";
}

const runtimeAppEnvironment = resolveAppEnvironment(configuredAppEnvironment);

function isLocalSandboxHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return new Set(["localhost", "127.0.0.1", "::1", "10.0.2.2"]).has(normalized);
}

function normalizeApiUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function parseHttpUrl(value: string): URL | null {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function resolveApiUrl(
  configuredValue: string | undefined,
  production = isProductionBuild,
  allowInsecureHttp = allowInsecureSandboxHttp,
  runtimePlatform: string = Platform.OS as string,
  appEnvironment: AppEnvironment = runtimeAppEnvironment,
): string {
  const configuredUrl = configuredValue?.trim();
  const protectedEnvironment =
    appEnvironment === "staging" ||
    appEnvironment === "production" ||
    (production && appEnvironment !== "local-sandbox");

  if (allowInsecureHttp && appEnvironment !== "local-sandbox") {
    throw new Error("EXPO_PUBLIC_SANDBOX_HTTP chỉ được bật cho bản sandbox local.");
  }

  if (!configuredUrl) {
    if (protectedEnvironment) {
      throw new Error(
        "EXPO_PUBLIC_API_URL phải được cấu hình cho bản production.",
      );
    }

  }

  const apiUrl = configuredUrl ?? DEFAULT_DEVELOPMENT_API_URL;
  const parsedUrl = parseHttpUrl(apiUrl);

  if (!parsedUrl) {
    throw new Error("EXPO_PUBLIC_API_URL phải là một URL HTTP hợp lệ.");
  }

  if (parsedUrl.protocol === "http:") {
    if (
      protectedEnvironment ||
      appEnvironment !== "local-sandbox" ||
      !allowInsecureHttp ||
      !isLocalSandboxHostname(parsedUrl.hostname)
    ) {
      throw new Error("HTTP chỉ được dùng với API local khi bật cờ sandbox local.");
    }
  } else if (allowInsecureHttp) {
    throw new Error("Tắt EXPO_PUBLIC_SANDBOX_HTTP khi API URL đã dùng HTTPS.");
  }

  // 10.0.2.2 is the Android emulator's host alias. A browser running the Expo
  // Web app on this machine must reach the same local preview through localhost.
  if (runtimePlatform === "web" && parsedUrl.hostname === "10.0.2.2") {
    parsedUrl.hostname = "localhost";
    return normalizeApiUrl(parsedUrl.toString());
  }

  return normalizeApiUrl(apiUrl);
}

export const API_URL = resolveApiUrl(process.env.EXPO_PUBLIC_API_URL);

export const apiConfig = {
  get baseUrl(): string {
    if (Platform.OS === "web" && typeof window !== "undefined" && window.location?.hostname) {
      const host = window.location.hostname;
      if (host && host !== "localhost" && host !== "127.0.0.1") {
        return API_URL.replace(/localhost|127\.0\.0\.1|10\.0\.2\.2/, host);
      }
    }
    return API_URL;
  },
} as const;
