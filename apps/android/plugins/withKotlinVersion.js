const { withGradleProperties, withProjectBuildGradle } = require("expo/config-plugins");

const KOTLIN_VERSION = "1.9.25";
const KOTLIN_GRADLE_PLUGIN = "org.jetbrains.kotlin:kotlin-gradle-plugin";

/**
 * Android release toolchain policy for AgentMoataz.
 *
 * - Compose compiler 1.5.15 requires Kotlin 1.9.25.
 * - Product requirement is Android 8.0+ => minSdk 26.
 * - Release target is 64-bit ARM only => arm64-v8a.
 *
 * The Expo SDK 52 template declares the Kotlin Gradle plugin without a version.
 * React Native's Gradle plugin then supplies Kotlin 1.9.24 transitively, even
 * when android.kotlinVersion and rootProject.ext.kotlinVersion are both 1.9.25.
 * Pinning the buildscript classpath is therefore necessary as well.
 */
module.exports = function withAndroidReleaseToolchain(config) {
  config = withGradleProperties(config, (configWithProps) => {
    const desired = {
      "android.kotlinVersion": KOTLIN_VERSION,
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

  return withProjectBuildGradle(config, (configWithGradle) => {
    if (configWithGradle.modResults.language !== "groovy") {
      throw new Error("AgentMoataz requires a Groovy Android root build.gradle file.");
    }

    const kotlinClasspathPattern = /classpath\s*\(\s*['"]org\.jetbrains\.kotlin:kotlin-gradle-plugin(?::[^'"]*)?['"]\s*\)/g;
    const replacement = `classpath("${KOTLIN_GRADLE_PLUGIN}:${KOTLIN_VERSION}")`;
    const contents = configWithGradle.modResults.contents;

    if (!kotlinClasspathPattern.test(contents)) {
      throw new Error("Could not locate the Kotlin Gradle plugin in the Android root build.gradle file.");
    }

    configWithGradle.modResults.contents = contents.replace(kotlinClasspathPattern, replacement);
    return configWithGradle;
  });
};
