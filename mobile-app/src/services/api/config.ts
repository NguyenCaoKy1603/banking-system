const DEFAULT_DEVELOPMENT_API_URL = "http://10.0.2.2:5000/api/v1";

export const isProductionBuild = process.env.NODE_ENV === "production";
const allowInsecureSandboxHttp = process.env.EXPO_PUBLIC_SANDBOX_HTTP === "1";

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
): string {
  const configuredUrl = configuredValue?.trim();

  if (!configuredUrl) {
    if (production) {
      throw new Error(
        "EXPO_PUBLIC_API_URL phải được cấu hình cho bản production.",
      );
    }

    return DEFAULT_DEVELOPMENT_API_URL;
  }

  const parsedUrl = parseHttpUrl(configuredUrl);

  if (!parsedUrl) {
    throw new Error("EXPO_PUBLIC_API_URL phải là một URL HTTP hợp lệ.");
  }

  if (production && parsedUrl.protocol !== "https:" && !allowInsecureHttp) {
    throw new Error("Bản production chỉ được gọi API qua HTTPS.");
  }

  return normalizeApiUrl(configuredUrl);
}

export const API_URL = resolveApiUrl(process.env.EXPO_PUBLIC_API_URL);

export const apiConfig = {
  baseUrl: API_URL,
} as const;
