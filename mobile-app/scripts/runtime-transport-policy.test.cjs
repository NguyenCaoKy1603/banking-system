const assert = require("node:assert/strict");
const test = require("node:test");
const {
  applyAndroidCleartextPolicy,
  LOCAL_HTTPS_NETWORK_SECURITY_CONFIG,
  resolveTransportBuildPolicy,
} = require("../app.config.js");

function localSandbox(overrides = {}) {
  return {
    APP_VARIANT: "local-sandbox",
    EXPO_PUBLIC_API_URL: "http://10.0.2.2:5000/api/v1",
    EXPO_PUBLIC_SANDBOX_HTTP: "1",
    ...overrides,
  };
}

test("local sandbox build permits emulator loopback HTTP and Android cleartext", () => {
  assert.deepEqual(resolveTransportBuildPolicy(localSandbox()), {
    appEnvironment: "local-sandbox",
    allowAndroidCleartext: true,
    trustLocalUserCa: false,
  });
});

test("Android manifest receives cleartext=true only for an approved local sandbox", () => {
  const manifestConfig = {
    modResults: { manifest: { application: [{ $: {} }] } },
  };
  assert.equal(applyAndroidCleartextPolicy(manifestConfig, true).modResults.manifest.application[0].$[
    "android:usesCleartextTraffic"
  ], "true");
});

test("Android manifest explicitly disables cleartext outside the local sandbox", () => {
  const manifestConfig = {
    modResults: { manifest: { application: [{ $: {
      "android:usesCleartextTraffic": "true",
      "android:networkSecurityConfig": "@xml/network_security_config",
    } }] } },
  };
  assert.equal(applyAndroidCleartextPolicy(manifestConfig, false).modResults.manifest.application[0].$[
    "android:usesCleartextTraffic"
  ], "false");
  assert.equal("android:networkSecurityConfig" in manifestConfig.modResults.manifest.application[0].$, false);
});

test("local HTTPS debug build trusts user CAs for localhost only", () => {
  assert.deepEqual(resolveTransportBuildPolicy(localSandbox({
    EXPO_PUBLIC_API_URL: "https://localhost:5443/api/v1",
    EXPO_PUBLIC_SANDBOX_HTTP: "0",
    LOCAL_HTTPS_TRUST_USER_CA: "1",
  })), {
    appEnvironment: "local-sandbox",
    allowAndroidCleartext: false,
    trustLocalUserCa: true,
  });

  const manifestConfig = {
    modResults: { manifest: { application: [{ $: {} }] } },
  };
  assert.equal(applyAndroidCleartextPolicy(manifestConfig, false, true).modResults.manifest.application[0].$[
    "android:networkSecurityConfig"
  ], "@xml/network_security_config");
  assert.match(LOCAL_HTTPS_NETWORK_SECURITY_CONFIG, /<base-config cleartextTrafficPermitted="false">/);
  assert.match(LOCAL_HTTPS_NETWORK_SECURITY_CONFIG, /<domain-config cleartextTrafficPermitted="true">/);
  assert.match(LOCAL_HTTPS_NETWORK_SECURITY_CONFIG, /<domain includeSubdomains="false">localhost<\/domain>/);
  assert.match(LOCAL_HTTPS_NETWORK_SECURITY_CONFIG, /<certificates src="user" \/>/);
});

test("approved preview EAS profile maps to local sandbox", () => {
  assert.deepEqual(resolveTransportBuildPolicy(localSandbox({
    EAS_BUILD_PROFILE: "preview",
    APP_VARIANT: "local-sandbox",
  })), {
    appEnvironment: "local-sandbox",
    allowAndroidCleartext: true,
    trustLocalUserCa: false,
  });
});

test("staging profile refuses the sandbox flag even with an HTTPS endpoint", () => {
  assert.throws(() => resolveTransportBuildPolicy({
    EAS_BUILD_PROFILE: "staging",
    APP_VARIANT: "staging",
    EXPO_PUBLIC_API_URL: "https://api.example.test/api/v1",
    EXPO_PUBLIC_SANDBOX_HTTP: "1",
  }), /phải từ chối EXPO_PUBLIC_SANDBOX_HTTP=1/);
});

test("production profile refuses the sandbox flag", () => {
  assert.throws(() => resolveTransportBuildPolicy({
    EAS_BUILD_PROFILE: "production",
    APP_VARIANT: "production",
    EXPO_PUBLIC_API_URL: "https://api.example.test/api/v1",
    EXPO_PUBLIC_SANDBOX_HTTP: "1",
  }), /phải từ chối EXPO_PUBLIC_SANDBOX_HTTP=1/);
});

test("staging with HTTPS and cleartext disabled is accepted", () => {
  assert.deepEqual(resolveTransportBuildPolicy({
    EAS_BUILD_PROFILE: "staging",
    APP_VARIANT: "staging",
    EXPO_PUBLIC_API_URL: "https://api.example.test/api/v1",
    EXPO_PUBLIC_SANDBOX_HTTP: "0",
  }), {
    appEnvironment: "staging",
    allowAndroidCleartext: false,
    trustLocalUserCa: false,
  });
});

test("user CA trust is rejected for EAS, non-local hosts, and non-sandbox environments", () => {
  assert.throws(() => resolveTransportBuildPolicy(localSandbox({
    EAS_BUILD_PROFILE: "preview",
    EXPO_PUBLIC_API_URL: "https://localhost:5443/api/v1",
    EXPO_PUBLIC_SANDBOX_HTTP: "0",
    LOCAL_HTTPS_TRUST_USER_CA: "1",
  })), /chỉ được dùng khi build local trực tiếp/);

  assert.throws(() => resolveTransportBuildPolicy(localSandbox({
    EXPO_PUBLIC_API_URL: "https://api.example.test/api/v1",
    EXPO_PUBLIC_SANDBOX_HTTP: "0",
    LOCAL_HTTPS_TRUST_USER_CA: "1",
  })), /hostname localhost/);

  assert.throws(() => resolveTransportBuildPolicy({
    APP_VARIANT: "staging",
    EXPO_PUBLIC_API_URL: "https://localhost:5443/api/v1",
    EXPO_PUBLIC_SANDBOX_HTTP: "0",
    LOCAL_HTTPS_TRUST_USER_CA: "1",
  }), /chỉ được dùng trong local-sandbox/);
});

test("staging rejects HTTP even when the cleartext flag is disabled", () => {
  assert.throws(() => resolveTransportBuildPolicy({
    EAS_BUILD_PROFILE: "staging",
    APP_VARIANT: "staging",
    EXPO_PUBLIC_API_URL: "http://10.0.2.2:5000/api/v1",
    EXPO_PUBLIC_SANDBOX_HTTP: "0",
  }), /HTTP chỉ được dùng/);
});

test("build profile and declared app variant must agree", () => {
  assert.throws(() => resolveTransportBuildPolicy(localSandbox({
    EAS_BUILD_PROFILE: "staging",
  })), /không khớp với EAS build profile/);
});

test("HTTP sandbox cannot target a public host", () => {
  assert.throws(() => resolveTransportBuildPolicy(localSandbox({
    EXPO_PUBLIC_API_URL: "http://api.example.test/api/v1",
  })), /loopback/);
});

test("sandbox HTTP flag accepts only explicit values", () => {
  assert.throws(() => resolveTransportBuildPolicy(localSandbox({
    EXPO_PUBLIC_SANDBOX_HTTP: "true",
  })), /chỉ nhận giá trị 0 hoặc 1/);
});

test("unknown EAS profile cannot enable HTTP sandbox", () => {
  assert.throws(() => resolveTransportBuildPolicy(localSandbox({
    EAS_BUILD_PROFILE: "custom-release",
  })), /profile chưa được cho phép/);
});
