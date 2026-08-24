/**
 * Expo SDK 52's Android Gradle namespace is `expo.core`, but its React Native
 * package class lives in `expo.modules`. With pnpm's isolated node_modules the
 * Expo package's own react-native.config.js can fail to load, so autolinking
 * falls back to the namespace and generates an invalid ExpoModulesPackage
 * import. Keep the correct override in the application-level config as well.
 */
module.exports = {
  dependencies: {
    expo: {
      platforms: {
        android: {
          packageImportPath: "import expo.modules.ExpoModulesPackage;",
          packageInstance: "new ExpoModulesPackage()",
        },
      },
    },
  },
};
