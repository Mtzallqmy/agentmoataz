const { withGradleProperties } = require("expo/config-plugins");

/**
 * Android release toolchain policy for AgentMoataz.
 *
 * - Compose compiler 1.5.15 requires Kotlin 1.9.25.
 * - Product requirement is Android 8.0+ => minSdk 26.
 * - Release target is 64-bit ARM only => arm64-v8a.
 *
 * Keeping these values in the Expo config-plugin path makes `expo prebuild`
 * deterministic in local development, CI and release automation.
 */
module.exports = function withAndroidReleaseToolchain(config) {
  return withGradleProperties(config, (configWithProps) => {
    const desired = {
      "android.kotlinVersion": "1.9.25",
      "android.minSdkVersion": "26",
      reactNativeArchitectures: "arm64-v8a",
    };

    configWithProps.modResults = configWithProps.modResults.filter(
      (item) => !(item.type === "property" && Object.prototype.hasOwnProperty.call(desired, item.key))
    );

    for (const [key, value] of Object.entries(desired)) {
      configWithProps.modResults.push({ type: "property", key, value });
    }

    return configWithProps;
  });
};
