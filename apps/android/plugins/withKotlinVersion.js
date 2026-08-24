const { withGradleProperties } = require("expo/config-plugins");

/**
 * Expo SDK 52's Compose compiler 1.5.15 requires Kotlin 1.9.25.
 * Keep this in app config so every `expo prebuild` (local, CI, or EAS)
 * generates the same compatible Android toolchain.
 */
module.exports = function withKotlinVersion(config) {
  return withGradleProperties(config, (configWithProps) => {
    configWithProps.modResults = configWithProps.modResults.filter(
      (item) => !(item.type === "property" && item.key === "android.kotlinVersion")
    );
    configWithProps.modResults.push({
      type: "property",
      key: "android.kotlinVersion",
      value: "1.9.25",
    });
    return configWithProps;
  });
};
