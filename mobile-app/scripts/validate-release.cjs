const fs = require("node:fs");
const path = require("node:path");

const projectRoot = process.cwd();
const appConfig = JSON.parse(fs.readFileSync(path.join(projectRoot, "app.json"), "utf8"));
const easConfig = JSON.parse(fs.readFileSync(path.join(projectRoot, "eas.json"), "utf8"));
const android = appConfig.expo?.android;
const preview = easConfig.build?.preview;
const development = easConfig.build?.development;
const staging = easConfig.build?.staging;
const production = easConfig.build?.production;

function assertTransportProfile(profile, expectedVariant, expectedSandboxFlag) {
  if (
    profile?.env?.APP_VARIANT !== expectedVariant ||
    profile?.env?.EXPO_PUBLIC_SANDBOX_HTTP !== expectedSandboxFlag
  ) {
    throw new Error(`EAS ${expectedVariant} transport environment is inconsistent.`);
  }
}

if (!/^([a-z][a-z0-9]*\.)+[a-z][a-z0-9]*$/.test(android?.package ?? "")) {
  throw new Error("app.json must define a valid android.package.");
}

if (preview?.android?.buildType !== "apk" || preview?.distribution !== "internal") {
  throw new Error("EAS preview must create an internal APK.");
}

if (preview?.environment !== "preview" || production?.environment !== "production") {
  throw new Error("EAS preview/production profiles must select their environment.");
}
if (staging?.android?.buildType !== "apk" || staging?.distribution !== "internal" || staging?.environment !== "staging") {
  throw new Error("EAS staging must create an internal APK with the staging environment.");
}
assertTransportProfile(development, "local-sandbox", "1");
assertTransportProfile(preview, "local-sandbox", "1");
assertTransportProfile(staging, "staging", "0");
assertTransportProfile(production, "production", "0");

const exampleEnv = fs.readFileSync(path.join(projectRoot, ".env.example"), "utf8");
if (
  !exampleEnv.includes("APP_VARIANT=local-sandbox") ||
  !exampleEnv.includes("EXPO_PUBLIC_SANDBOX_HTTP=1") ||
  !exampleEnv.includes("EXPO_PUBLIC_API_URL=http://10.0.2.2:5000/api/v1") ||
  !exampleEnv.includes("https://api.example.invalid/api/v1")
) {
  throw new Error(".env.example must document the local sandbox and HTTPS deployment settings.");
}

console.log(`Release config valid: ${android.package}; local sandbox permits loopback HTTP; staging/production require HTTPS.`);
