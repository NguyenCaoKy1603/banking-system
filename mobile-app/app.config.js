const appJson = require("./app.json");
const { withAndroidManifest } = require("@expo/config-plugins");

module.exports = ({ config }) => {
  const expoConfig = {
    ...appJson.expo,
    ...config,
    android: {
      ...appJson.expo.android,
      ...(config?.android ?? {}),
    },
  };

  if (process.env.EXPO_PUBLIC_SANDBOX_HTTP === "1") {
    return withAndroidManifest(expoConfig, (manifestConfig) => {
      const application = manifestConfig.modResults.manifest.application?.[0];
      if (application) {
        application.$["android:usesCleartextTraffic"] = "true";
      }
      return manifestConfig;
    });
  }

  return expoConfig;
};
