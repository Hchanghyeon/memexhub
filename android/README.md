# memexhub for Android

A phone app that sends your life logs to your own memexhub server: the job iOS Shortcuts and OwnTracks do today, in one app. Kotlin + Jetpack Compose, Android 9 or newer.

| Record | Sends to | Status |
|---|---|---|
| Card messages (from the Messages app's notifications) | `/ingest/message` (channel `sms`, with sender and time) | ✅ |
| Payment notifications (Samsung Wallet) | `/ingest/message` (channel `notification`) | ✅ |
| Location | `/ingest/owntracks` (same format as OwnTracks) | ✅ |
| Health (Health Connect) | `/ingest/health` | 📝 |

Each record has its own switch. Records wait in a queue (WorkManager) until there is a network, so nothing is lost on the subway or in airplane mode; a busy or unreachable server is retried with backoff.

### Card messages and wallet payments

No SMS permission: Galaxy phones sold in Korea refuse to install a sideloaded app that receives texts ("suspected malicious app", and the block cannot be turned off), because that is what smishing apps do. The app reads notifications instead, with notification access:

- the Messages app's notifications (Samsung Messages, Google Messages) → channel `sms`, sender and full text
- Samsung Wallet's notifications → channel `notification`

Only notifications from those apps containing 승인, 결제 or 취소 leave the phone; each message is sent once even when the app re-posts it. The server's recipes read the text, and what it is unsure about waits on the admin app's Messages screen.

Android 13+ treats notification access of apps installed outside a store as a *restricted setting*: if memexhub is greyed out in the notification access list, App info → ⋮ → **Allow restricted settings** first.

### Location

Like OwnTracks in Move mode: a point every 3 minutes (fused provider, balanced power; GPS and network before Android 12), fixes worse than 500 m dropped, sent in the OwnTracks format so the server's location module reads it unchanged. A foreground service with a quiet notification keeps it running with the screen off. Allowing location *All the time* lets it start again after a reboot or an app update; without it, opening the app starts it.

### Notifications

Every 15 minutes (WorkManager, only with a network) the app asks `GET /ingest/status` and checks its own switches, then notifies only what is new and removes what got fixed:

- a record this phone sends stopped (location, card texts), by the server's freshness rules
- card texts waiting on the admin app's Messages screen (tap opens it)
- a connection in error (tap opens Connections)
- a permission was removed, or the server refused the token

The status holds counts, times and connection names only. No push service is involved.

### Notes

The **Notes** tab reads the vault through the admin app's JSON API, signed in with the admin account (the authenticator code outside the home network; "stay signed in" keeps it 30 days). The device token is never used for reading. Read-only: folders, search, recently changed notes, and the note rendered from Markdown (headings, lists, task lists, tables, code, quotes, Obsidian callouts). `[[wiki links]]` open the note they name; `![[attachments]]` show their name. Session cookies are stored encrypted like the device token.

### Today

The first tab: today's to-dos (checkboxes under the "할 일" / "to-do" heading of the day's journal note, open ones first, with a progress bar), money spent today against yesterday and the month (`/admin/api/money`), places and distance (`/admin/api/location/day`), and whether this phone's records are flowing. Pull down to refresh. Without the admin sign-in it shows only this phone's records.

### Map

The **Map** tab draws the day's path and numbered stays over OpenStreetMap tiles that the server caches (`/admin/api/map/tile`), with its own small renderer: no Google services, no API key, and locations never leave your server. Drag and pinch, tap a stay or pick it in the list to centre it, step through days. Cover screen: map above the stays; unfolded: map left, stays right.

### Account and security

Records → Account and security, signed in as the admin: change the password; turn two-factor on, move it to a new authenticator app (the key opens straight in the authenticator app on the phone; outside the home network the current code is asked first; the old key works until the new one is confirmed), or turn it off (home network only, with the password; the admin app then opens on the home network only); forget remembered devices; sign out.

## Screens

Built only from design tokens (`design/tokens.json`) and the parts in `ui/kit` (big number card, to-do row, list row, status dot, button with press feedback and haptics). Four tabs, Today, Map, Notes and Records: a bottom bar under 600 dp, a side rail from 600 dp. Under 600 dp wide (phones, a foldable's cover screen) each tab is a list that opens one item; from 600 dp (an unfolded foldable, tablets) the list and the selected item sit side by side. The selection survives folding and unfolding. `ScreenshotTest` renders each screen on the JVM as the Galaxy Z Fold shows it (cover 411 dp, unfolded 840 dp, light and dark, Korean): `./gradlew recordRoborazziDebug`; CI uploads them as the `screenshots` artifact.

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
