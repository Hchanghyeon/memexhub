# memexhub for Android

A phone app that sends your life logs to your own memexhub server: the job iOS Shortcuts and OwnTracks do today, in one app. Kotlin + Jetpack Compose, Android 9 or newer.

| Record | Sends to | Status |
|---|---|---|
| Card messages (SMS) | `/ingest/message` (channel `sms`, with sender and time) | ✅ |
| Payment notifications (wallets, transit cards) | `/ingest/transaction` | 📝 |
| Location | `/ingest/owntracks` (same format as OwnTracks) | ✅ |
| Health (Health Connect) | `/ingest/health` | 📝 |

Each record has its own switch. Records wait in a queue (WorkManager) until there is a network, so nothing is lost on the subway or in airplane mode; a busy or unreachable server is retried with backoff.

### Card messages

Only texts containing 승인, 결제 or 취소 leave the phone; codes, chats and everything else stay. The server's recipes read the text, and texts it is unsure about wait on the admin app's Messages screen.

Android 13+ treats SMS access of apps installed outside a store as a *restricted setting*. If the permission dialog does not appear: App info → ⋮ → **Allow restricted settings**, then turn the switch on again.

### Location

Like OwnTracks in Move mode: a point every 3 minutes (fused provider, balanced power; GPS and network before Android 12), fixes worse than 500 m dropped, sent in the OwnTracks format so the server's location module reads it unchanged. A foreground service with a quiet notification keeps it running with the screen off. Allowing location *All the time* lets it start again after a reboot or an app update; without it, opening the app starts it.

## Screens

One layout for every size: under 600 dp wide (phones, a foldable's cover screen) it is a list that opens each record; from 600 dp (an unfolded foldable, tablets) the list and the selected record sit side by side. The selection survives folding and unfolding. The previews in `ui/App.kt` show phone, unfolded foldable and tablet.

## Privacy

- The device token is encrypted with a key kept in the Android Keystore and is excluded from cloud backup and device transfer.
- Only `https` server addresses are accepted.
- The app only writes to the ingest surface; it cannot read your vault.

## Build

```bash
cd android
echo "sdk.dir=/path/to/android-sdk" > local.properties   # or set ANDROID_HOME
./gradlew assembleDebug                                  # app/build/outputs/apk/debug/app-debug.apk
```

Needs JDK 21 or newer and the Android SDK platform 37.2. CI builds a debug APK on every change under `android/` (workflow `android`, artifact `memexhub-debug-apk`).

Not on Google Play: Play rarely allows apps to read SMS. Install the APK directly.

## Release builds

Every version must be signed with the same key, or Android refuses to install it over the previous one. Keep the key outside the repository and back it up.

```bash
keytool -genkeypair -keystore release.jks -storetype PKCS12 -alias memexhub -keyalg RSA -keysize 4096 -validity 36500 -dname "CN=memexhub"
./gradlew assembleRelease \
  -Pandroid.injected.signing.store.file=/path/to/release.jks \
  -Pandroid.injected.signing.store.password=… -Pandroid.injected.signing.key.alias=memexhub -Pandroid.injected.signing.key.password=…
```

To let CI sign: add the repository secrets `ANDROID_KEYSTORE_BASE64` (`base64 -w0 release.jks`) and `ANDROID_KEYSTORE_PASSWORD`. Each push to `develop` or `main` that touches `android/` then uploads `memexhub-android-<version>` (the signed APK, kept 30 days) next to the debug build.
