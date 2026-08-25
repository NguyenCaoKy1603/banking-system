const fs = require("node:fs");
const path = require("node:path");

const projectRoot = process.cwd();
const appConfig = JSON.parse(fs.readFileSync(path.join(projectRoot, "app.json"), "utf8"));
const easConfig = JSON.parse(fs.readFileSync(path.join(projectRoot, "eas.json"), "utf8"));
const android = appConfig.expo?.android;
const preview = easConfig.build?.preview;
const staging = easConfig.build?.staging;
const production = easConfig.build?.production;

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

const exampleEnv = fs.readFileSync(path.join(projectRoot, ".env.example"), "utf8");
if (!exampleEnv.includes("EXPO_PUBLIC_API_URL") || !exampleEnv.includes("https://")) {
  throw new Error(".env.example must document an HTTPS production API URL placeholder.");
}

console.log(`Release config valid: ${android.package}; preview/staging APK; preview/production environments configured.`);
