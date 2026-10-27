# memexhub for Android

A phone app that sends your life logs to your own memexhub server: the job iOS Shortcuts and OwnTracks do today, in one app. Kotlin + Jetpack Compose, Android 9 or newer.

| Record | Sends to | Status |
|---|---|---|
| Card messages (SMS) | `/ingest/sms` | 📝 |
| Payment notifications (wallets, transit cards) | `/ingest/transaction` | 📝 |
| Location | `/ingest/owntracks` (same format as OwnTracks) | 📝 |
| Health (Health Connect) | `/ingest/health` | 📝 |

Today the app connects to a server (device address + device token) and shows the records above.

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

Not on Google Play: Play rarely allows apps to read SMS. Install the APK directly; signed release builds on GitHub Releases are planned.
