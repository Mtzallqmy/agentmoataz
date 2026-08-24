# Android Release Policy

AgentMoataz targets a phone-first Android release with the following enforced policy:

- **Minimum OS:** Android 8.0 (API 26)
- **CPU ABI:** 64-bit ARM only (`arm64-v8a`)
- **Application ID:** `dev.agentmoataz.app`
- **JDK:** 17
- **Release outputs:** APK and, for production signing, AAB
- **Rust/C++:** not required by the application MVP

The Expo config plugin `apps/android/plugins/withKotlinVersion.js` writes the Android build policy during every `expo prebuild`:

```properties
android.minSdkVersion=26
reactNativeArchitectures=arm64-v8a
android.kotlinVersion=1.9.25
```

CI verifies those generated properties and also inspects the final APK with Android build tools. A release is rejected if the APK has a minSdk other than 26, contains a non-arm64 native ABI, or fails APK signature verification.

## CI-installable release

The normal pull-request CI builds a real `assembleRelease` APK and signs it with a temporary CI-only key. This artifact is suitable for installation and runtime testing, but **the CI key is intentionally not a production/update key**. A new CI key may be generated on another run, so do not publish CI-signed APKs as a long-lived distribution channel.

Artifact name:

```text
agentmoataz-android8plus-arm64-release-ci-signed
```

It contains:

```text
app-release.apk
app-release.apk.sha256
```

## Production signing

`.github/workflows/android-release.yml` builds the production-signed APK and AAB. It refuses to run unless all signing secrets exist.

Create one long-lived Android upload/release keystore and protect it. Do not commit it.

Required GitHub Actions secrets:

```text
RELEASE_KEYSTORE_BASE64
RELEASE_STORE_PASSWORD
RELEASE_KEY_ALIAS
RELEASE_KEY_PASSWORD
```

Example keystore creation (run on a trusted machine and keep the file backed up securely):

```bash
keytool -genkeypair \
  -storetype PKCS12 \
  -keystore agentmoataz-release.p12 \
  -alias agentmoataz \
  -keyalg RSA \
  -keysize 4096 \
  -validity 10000
```

Encode the binary keystore for `RELEASE_KEYSTORE_BASE64`:

Linux:

```bash
base64 -w 0 agentmoataz-release.p12
```

macOS:

```bash
base64 < agentmoataz-release.p12 | tr -d '\n'
```

Never print signing passwords or the keystore content into CI logs.

## Production workflow

Run **Android Production Release** manually in GitHub Actions, or push a version tag such as:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The workflow executes quality gates, Expo prebuild, `assembleRelease`, `bundleRelease`, ABI/minSdk checks, signature verification, and SHA-256 generation.

Expected artifacts:

```text
app-release.apk
app-release.apk.sha256
app-release.aab
app-release.aab.sha256
```

## Local release build

Prerequisites:

- Node.js 20+
- pnpm 11.9.0
- JDK 17
- Android SDK / `ANDROID_HOME`

Prepare the native project:

```bash
pnpm install --frozen-lockfile
cd apps/android
pnpm exec expo prebuild --platform android --clean
cd android
```

Then run Gradle with a trusted signing key. Do not place passwords in committed files. The production CI uses Android Gradle Plugin injected signing properties so the generated Expo Gradle project does not contain credentials.

## Compatibility interpretation

`arm64-v8a` means the APK intentionally targets 64-bit ARM Android devices. Android 8.0+ devices whose operating system only supports 32-bit ARM are outside this release target. The final APK manifest is checked for `minSdkVersion=26`.

When increasing `expo.version`, also increase `expo.android.versionCode`; Android requires monotonically increasing version codes for upgrades.
