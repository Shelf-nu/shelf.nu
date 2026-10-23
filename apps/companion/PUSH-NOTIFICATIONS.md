# Push notifications: credentials and native setup

The companion receives remote pushes through the Expo push service
(`expo-notifications` in the app, `expo-server-sdk` in the webapp). Expo
forwards each message to Apple (APNs) or Google (FCM), and both providers
need a credential that only the Apple and Google account holders can create.
This page is the checklist for that one-time setup and the rules that keep it
working on this bare iOS project.

Nothing here ships over the air. The dependency, the entitlement and the
Android Firebase file are compiled in, so every item below lands with a store
build (see [STORE-RELEASE.md](./STORE-RELEASE.md)).

## Who does what

| Step                                  | Owner                          | Where                          |
| ------------------------------------- | ------------------------------ | ------------------------------ |
| 1. APNs key                           | Apple Developer account holder | `eas credentials` on a Mac     |
| 2. Firebase project + FCM V1 key      | Google account holder          | Firebase console, then EAS     |
| 3. `google-services.json` in the repo | whoever did step 2             | `apps/companion/`              |
| 4. Enhanced push security             | EAS project owner              | expo.dev dashboard             |
| 5. `EXPO_ACCESS_TOKEN` on the webapp  | whoever deploys the webapp     | Fly secrets / `.env`           |
| 6. iOS entitlement stays in git       | every companion contributor    | `ios/Shelf/Shelf.entitlements` |

## 1. APNs key (iOS)

One `.p8` key per Apple team covers every app in the team, so this is done
once. A paid Apple Developer account is required (the team is `27Q4MHFB8K`).

```bash
cd apps/companion
eas credentials --platform ios
```

In the menu: profile `production`, bundle identifier `com.shelf.companion`,
then "Push Notifications: Manage your Apple Push Notifications Key", then
"Set up a new key". EAS signs in to Apple with the account's two-factor code,
generates the key and stores it on the EAS project. Nothing is written to the
repo.

Check it on `https://expo.dev/accounts/shelfassetmanagement/projects/shelf-companion/credentials`.
The iOS card for `com.shelf.companion` must list a Push Key.

If the Apple login in the CLI keeps rejecting two-factor codes (an old
`eas-cli` does), create the key by hand instead: developer.apple.com,
Certificates, Identifiers and Profiles, Keys, +, tick Apple Push Notifications
service, press Configure next to it and set the environment to Sandbox and
Production (it cannot be changed after the key exists), Save, Continue,
Register, then Download at once: Apple keeps no copy of the file.
Then run `eas credentials --platform ios`, answer **n** to the Apple login,
pick Push Notifications, "Add a new push key", **n** to generating one, and
give the `.p8` path, the Key ID and the team id. Keep the `.p8` outside the
repo with a copy in the team password manager; Apple never re-issues it.

The local dev build (`expo run:ios --device`) signs as the Debug bundle id
`com.shelf.companion.carlos`. Three things that id needs once, none of which
Xcode does on its own:

1. The Push Notifications capability on that App ID in the developer portal
   (Identifiers, the `.carlos` entry, tick Push Notifications, Save). Without
   it the build fails with "provisioning profile doesn't include the
   aps-environment entitlement". If it still fails after ticking, delete the
   cached profile under `~/Library/Developer/Xcode/UserData/Provisioning
Profiles` that names `com.shelf.companion.carlos`, so Xcode fetches a fresh
   one.
2. The push key attached to that bundle id on EAS. EAS keeps push keys per
   bundle id and reads the id from the Xcode build configuration of the
   profile you pick, so `production` always means `com.shelf.companion`. To
   reach the Debug id, temporarily set `development.ios.buildConfiguration`
   to `Debug` and `development.ios.simulator` to `false` in `eas.json`, run
   `eas credentials --platform ios`, pick `development`, **n**, Push
   Notifications, "Use an existing push key", Adhoc, the key, then revert
   `eas.json`. The same `.p8` serves both ids because the key is per team.
3. The app config the build reads. A fresh checkout has no
   `apps/companion/.env.local`; create it with
   `node scripts/setup-sim-env.mjs --api-url=https://app.shelf.nu` and restart
   Metro with a cache clear.

## 2. Firebase project and FCM V1 service account (Android)

Android pushes need a Firebase project. There is none yet.

1. In the [Firebase console](https://console.firebase.google.com) create a
   project for Shelf, then add an Android app with package name
   `com.shelf.companion`.
2. Project settings, Service accounts, "Generate new private key". Keep the
   downloaded JSON out of the repo; it is a secret.
3. Upload it to EAS. Either

   ```bash
   cd apps/companion
   eas credentials --platform android
   ```

   then profile `production`, "Google Service Account", "Manage your Google
   Service Account Key for Push Notifications (FCM V1)", "Set up a new key",
   or on expo.dev open the project's Credentials page, pick the Android
   application identifier, and under "FCM V1 service account key" upload the
   JSON.

`.gitignore` already ignores `*.p8`, `*.p12` and `*.key`. Add the service
account JSON there too if it ever lands in the tree.

## 3. `google-services.json`

The Android app registers with FCM through this file. It is committed at
`apps/companion/google-services.json` and `app.json` points
`expo.android.googleServicesFile` at it.

The file carries the Firebase project id and number, the package name, and a
Firebase client API key. That key is not a secret in the usual sense: it ships
inside every Android build and only identifies the project to Google; Expo's
own guidance is to commit the file. What protects the project is the key's
restrictions and the absence of other Firebase products, so keep both true:

- In Google Cloud, APIs and Services, Credentials, the key is restricted to
  the Android app `com.shelf.companion` and to the Firebase Installations and
  Firebase Cloud Messaging APIs. Nothing else can be called with it.
- The `shelf-companion` Firebase project runs only Cloud Messaging. Do not
  enable Storage, Firestore or Realtime Database on it; a separate project
  with its own rules is the place for those.

If the Firebase project is ever recreated, download the new file from Project
settings, Your apps, the Android app, replace it, and restrict the new key.

## 4. Enhanced push security

On expo.dev, project settings, enable "Enhanced push security". From then on
every send must carry an EAS access token, so a leaked push token cannot be
used to spam a device from outside Shelf. Create the token under the account's
Access tokens page with a name such as `shelf-webapp-push`, and treat it like
a database password.

## 5. `EXPO_ACCESS_TOKEN` on the webapp

Set the token from step 4 as `EXPO_ACCESS_TOKEN` wherever the webapp runs
(Fly secrets in production, the root `.env` locally). The webapp sends without
a token until the dashboard toggle is on; after the toggle, sends without it
fail with `UNAUTHORIZED` and the push worker logs that as a configuration
error.

## 6. The iOS entitlement is hand-maintained

`ios/` is committed and built with `expo run:ios`. Config plugins only run
during `expo prebuild`, which this project never runs, so the
`expo-notifications` plugin in `app.json` configures Android at EAS build time
and does nothing for iOS. The APNs entitlement therefore lives in
`ios/Shelf/Shelf.entitlements` by hand:

```xml
<key>aps-environment</key>
<string>development</string>
```

Xcode and EAS switch the value to `production` when archiving. The rules:

- A `prebuild:clean` deletes the file. Restore it from git before building.
- Check the built app before a store cut:

  ```bash
  codesign -d --entitlements :- <path to Shelf.app> | grep aps-environment
  ```

- No `UIBackgroundModes` entry is needed. v1 pushes are user-visible
  notifications only; add `remote-notification` to `Info.plist` only if a
  silent background push is ever introduced.

## Testing a push by hand

1. Build to a physical device. Simulators cannot receive pushes from the Expo
   service.

   ```bash
   cd apps/companion
   LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 npx expo run:ios --device
   ```

   The locale variables matter: CocoaPods under Homebrew Ruby 4 fails with
   `Unicode Normalization not appropriate for ASCII-8BIT` in a shell without
   a UTF-8 locale.

2. In a development build, Settings, About, "Push token (dev)" shares the
   `ExponentPushToken[...]` string.
3. Send a test message to it. The Expo web tool at
   `https://expo.dev/notifications` works for a quick look, but it does not show
   the ticket id, so for the receipt check send with the API and read the id
   from the response (`data.id`):

   ```bash
   curl -sS https://exp.host/--/api/v2/push/send \
     -H "content-type: application/json" \
     -H "Authorization: Bearer <EAS access token>" \
     -d '{"to":"<ExponentPushToken>","title":"Shelf push test","body":"Hello"}'
   ```

   The Authorization header is required once enhanced push security is on
   (step 4); without the toggle it is ignored. Send the same header on the
   receipt request below. Watch the lock screen with the app in the background.

4. Fetch the receipt about 15 minutes later to confirm APNs accepted it:

   ```bash
   curl -sS https://exp.host/--/api/v2/push/getReceipts \
     -H "content-type: application/json" \
     -H "Authorization: Bearer <EAS access token>" \
     -d '{"ids":["<ticket id from the send response>"]}'
   ```

A `DeviceNotRegistered` receipt means the device is no longer registered, for
example after the app is uninstalled; the server disables such tokens on its
own.
