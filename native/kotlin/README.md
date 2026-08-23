# Kotlin native layer

Sources here are compiled into the Expo dev-client / custom build via the
Android app's `android/` project (generated with `npx expo prebuild`).

| File | Responsibility |
|---|---|
| `AgentForegroundService.kt` | Keeps long agent runs alive in background; persistent notification with pause/resume/cancel; `START_REDELIVER` so process death is visible |
| `SecureStorage.kt` | Keystore-backed secret storage; resolves `secretRef` → API key only for provider adapters; secrets never reach JS config or logs |
| `DeviceRuntime.kt` | Battery-optimization checks and abnormal-exit detection used by run recovery |

## Integration status
These sources are **not yet wired** into a Gradle build on this machine
(no JDK). Wiring steps when a JDK 17+ toolchain is available:

1. `cd apps/android && npx expo prebuild --platform android`
2. Copy these files into `android/app/src/main/java/dev/agentmoataz/native/`
3. Register the service in `AndroidManifest.xml` with
   `android:foregroundServiceType="dataSync"` and post-notification permission
4. Expose SecureStorage/DeviceRuntime to JS through an Expo Modules API
   (`expo-modules-core`) native module — async, cancellable, structured errors

Until then, all TypeScript packages remain green and the Android UI builds as
a plain Expo app.
