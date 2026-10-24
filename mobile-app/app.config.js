const appJson = require("./app.json");
const fs = require("node:fs/promises");
const syncFs = require("node:fs");
const path = require("node:path");
const { withAndroidManifest, withDangerousMod } = require("@expo/config-plugins");

const envFile = path.resolve(__dirname, ".env");
if (syncFs.existsSync(envFile)) {
  for (const line of syncFs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!(key in process.env)) {
        process.env[key] = val;
      }
    }
  }
}

const DEFAULT_LOCAL_API_URL = "http://10.0.2.2:5000/api/v1";
const LOCAL_HTTPS_CONFIG_RESOURCE = "network_security_config";
const LOCAL_HTTPS_NETWORK_SECURITY_CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false">
    <trust-anchors>
      <certificates src="system" />
    </trust-anchors>
  </base-config>
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">localhost</domain>
    <trust-anchors>
      <certificates src="system" />
      <certificates src="user" />
    </trust-anchors>
  </domain-config>
</network-security-config>
`;
const PROFILE_ENVIRONMENTS = Object.freeze({
  development: "local-sandbox",
  preview: "local-sandbox",
  staging: "staging",
  production: "production",
});
const APP_ENVIRONMENTS = new Set([
  "development",
  "local-sandbox",
  "staging",
  "production",
]);

function isLocalSandboxHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return new Set(["localhost", "127.0.0.1", "::1", "10.0.2.2"]).has(normalized);
}

function resolveTransportBuildPolicy(env = process.env) {
  const buildProfile = env.EAS_BUILD_PROFILE?.trim().toLowerCase();
  const profileEnvironment = buildProfile
    ? PROFILE_ENVIRONMENTS[buildProfile]
    : undefined;
  const requestedEnvironment = env.APP_VARIANT?.trim().toLowerCase();
  const sandboxSetting = env.EXPO_PUBLIC_SANDBOX_HTTP;
  const localHttpsTrustUserCaSetting = env.LOCAL_HTTPS_TRUST_USER_CA;
  const allowLocalHttp = sandboxSetting === "1";
  const trustLocalUserCa = localHttpsTrustUserCaSetting === "1";

  if (sandboxSetting !== undefined && sandboxSetting !== "0" && sandboxSetting !== "1") {
    throw new Error("EXPO_PUBLIC_SANDBOX_HTTP chỉ nhận giá trị 0 hoặc 1.");
  }
  if (localHttpsTrustUserCaSetting !== undefined && localHttpsTrustUserCaSetting !== "0" && localHttpsTrustUserCaSetting !== "1") {
    throw new Error("LOCAL_HTTPS_TRUST_USER_CA chỉ nhận giá trị 0 hoặc 1.");
  }
  if (requestedEnvironment && !APP_ENVIRONMENTS.has(requestedEnvironment)) {
    throw new Error("APP_VARIANT phải là development, local-sandbox, staging hoặc production.");
  }
  if (profileEnvironment && requestedEnvironment && requestedEnvironment !== profileEnvironment) {
    throw new Error("APP_VARIANT không khớp với EAS build profile.");
  }
  if (buildProfile && !profileEnvironment && allowLocalHttp) {
    throw new Error("Không thể bật HTTP sandbox local cho EAS profile chưa được cho phép.");
  }

  const appEnvironment =
    profileEnvironment ||
    requestedEnvironment ||
    (env.NODE_ENV === "production" ? "production" : "development");
  const protectedEnvironment = appEnvironment === "staging" || appEnvironment === "production";

  if (protectedEnvironment && allowLocalHttp) {
    throw new Error("Staging và production phải từ chối EXPO_PUBLIC_SANDBOX_HTTP=1.");
  }

  const apiUrl = (env.EXPO_PUBLIC_API_URL?.trim() || DEFAULT_LOCAL_API_URL);
  let parsedApiUrl;
  try {
    parsedApiUrl = new URL(apiUrl);
  } catch {
    throw new Error("EXPO_PUBLIC_API_URL phải là URL HTTP(S) hợp lệ.");
  }
  if (parsedApiUrl.protocol !== "http:" && parsedApiUrl.protocol !== "https:") {
    throw new Error("EXPO_PUBLIC_API_URL phải là URL HTTP(S) hợp lệ.");
  }

  const localHttpTarget =
    parsedApiUrl.protocol === "http:" && isLocalSandboxHostname(parsedApiUrl.hostname);
  if (parsedApiUrl.protocol === "http:" && (!allowLocalHttp || appEnvironment !== "local-sandbox" || !localHttpTarget)) {
    throw new Error("HTTP chỉ được dùng với API loopback của sandbox local và cờ EXPO_PUBLIC_SANDBOX_HTTP=1.");
  }
  if (allowLocalHttp && (!localHttpTarget || appEnvironment !== "local-sandbox")) {
    throw new Error("EXPO_PUBLIC_SANDBOX_HTTP=1 chỉ hợp lệ với API HTTP loopback của sandbox local.");
  }
  if (protectedEnvironment && parsedApiUrl.protocol !== "https:") {
    throw new Error("Staging và production bắt buộc dùng API HTTPS.");
  }
  if (trustLocalUserCa && buildProfile) {
    throw new Error("LOCAL_HTTPS_TRUST_USER_CA chỉ được dùng khi build local trực tiếp, không dùng EAS profile.");
  }
  if (trustLocalUserCa && appEnvironment !== "local-sandbox") {
    throw new Error("LOCAL_HTTPS_TRUST_USER_CA chỉ được dùng trong local-sandbox.");
  }
  if (trustLocalUserCa && (parsedApiUrl.protocol !== "https:" || parsedApiUrl.hostname.toLowerCase() !== "localhost")) {
    throw new Error("LOCAL_HTTPS_TRUST_USER_CA chỉ được dùng với API HTTPS có hostname localhost.");
  }

  return {
    appEnvironment,
    allowAndroidCleartext: allowLocalHttp,
    trustLocalUserCa,
  };
}

function applyAndroidCleartextPolicy(manifestConfig, allowAndroidCleartext, trustLocalUserCa = false) {
  const application = manifestConfig.modResults.manifest.application?.[0];
  if (application) {
    application.$["android:usesCleartextTraffic"] = allowAndroidCleartext ? "true" : "false";
    if (trustLocalUserCa) {
      application.$["android:networkSecurityConfig"] = `@xml/${LOCAL_HTTPS_CONFIG_RESOURCE}`;
    } else {
      delete application.$["android:networkSecurityConfig"];
    }
  }
  return manifestConfig;
}

function withLocalHttpsNetworkSecurityConfig(config, trustLocalUserCa) {
  return withDangerousMod(config, ["android", async (modConfig) => {
    if (modConfig.modRequest.introspect) return modConfig;

    const resourceDirectory = path.join(
      modConfig.modRequest.platformProjectRoot,
      "app",
      "src",
      "main",
      "res",
      "xml",
    );
    const resourcePath = path.join(resourceDirectory, `${LOCAL_HTTPS_CONFIG_RESOURCE}.xml`);

    if (trustLocalUserCa) {
      await fs.mkdir(resourceDirectory, { recursive: true });
      await fs.writeFile(resourcePath, LOCAL_HTTPS_NETWORK_SECURITY_CONFIG, "utf8");
    } else {
      await fs.rm(resourcePath, { force: true });
    }

    return modConfig;
  }]);
}

function configureExpo({ config }) {
  const transportPolicy = resolveTransportBuildPolicy();
  const expoConfig = {
    ...appJson.expo,
    ...config,
    extra: {
      ...appJson.expo.extra,
      ...(config?.extra ?? {}),
      runtimeEnvironment: transportPolicy.appEnvironment,
    },
    android: {
      ...appJson.expo.android,
      ...(config?.android ?? {}),
    },
  };

  const manifestConfigured = withAndroidManifest(expoConfig, (manifestConfig) =>
    applyAndroidCleartextPolicy(
      manifestConfig,
      transportPolicy.allowAndroidCleartext,
      transportPolicy.trustLocalUserCa,
    ),
  );

  return withLocalHttpsNetworkSecurityConfig(manifestConfigured, transportPolicy.trustLocalUserCa);
}

module.exports = configureExpo;
module.exports.resolveTransportBuildPolicy = resolveTransportBuildPolicy;
module.exports.applyAndroidCleartextPolicy = applyAndroidCleartextPolicy;
module.exports.LOCAL_HTTPS_NETWORK_SECURITY_CONFIG = LOCAL_HTTPS_NETWORK_SECURITY_CONFIG;
