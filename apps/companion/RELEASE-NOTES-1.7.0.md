# Shelf Companion 1.7.0: store release notes

Paste **one section**: the App Store text into App Store Connect (4000
characters allowed), the Google Play text into Play (500). The last section is
internal and must not reach a store listing.

---

## App Store: What's New

Push notifications.

- Get a notification when your booking is reserved, changed, due to go out or
  come back, or overdue
- Get a notification when you are assigned an audit, and before it is due
- Get your asset reminders on your phone
- Tap a notification to open that booking, audit or asset, even when it
  belongs to another of your workspaces
- Turn notifications on in Settings, Notifications, and choose which kinds you
  get

Push notifications are available on paid Shelf plans. Emails keep arriving as
before.

---

## Google Play: What's New (under 500 characters)

Push notifications: get notified when your booking is reserved, changed, due
or overdue, when you are assigned an audit, and for your asset reminders. Tap a
notification to open it in the app. Turn them on in Settings, Notifications,
and choose which kinds you get. Available on paid Shelf plans; emails are
unchanged.

---

## Not for the stores: worth knowing internally

**This build needs the push entitlement.** `ios/Shelf/Shelf.entitlements`
carries `aps-environment` (`development` in the file; Xcode and EAS switch it to
`production` when archiving). A `prebuild:clean` deletes that file, so restore
it from git before building. The App ID needs the Push Notifications
capability and the APNs key must be uploaded to Expo credentials, or
`getExpoPushTokenAsync` fails on every iPhone and nobody is registered.

**Android needs the Firebase file.** Push on Android requires
`apps/companion/google-services.json` from the Firebase project and the FCM V1
service account key uploaded to Expo credentials. EAS builds take the file
from the `GOOGLE_SERVICES_JSON` file variable in the `production` environment;
`app.config.js` maps it to `expo.android.googleServicesFile`, and a local build
falls back to a gitignored `./google-services.json`. Without the file and the
key, the Android build installs and runs, but registration fails and no Android
phone receives a push. Check both before `eas build --profile production`. The
steps are in `PUSH-NOTIFICATIONS.md`.

**The server ships first.** This build calls `/api/mobile/push-token` and
`/api/mobile/notification-preferences`, which arrive with the webapp push PR
(#3249). Deploy that to Shelf Cloud before this build goes live. A server
without those routes is not an error: registration stays quiet, and Settings,
Notifications says the server does not support push yet.

**Who gets pushes in this version.** Only the "about you" events: the custodian
of a booking, the assignees of an audit, and the people an asset reminder
names. Pushes go only to workspaces whose plan includes push; the server checks
the plan of the workspace the event happened in, at send time. The switches in
the app silence push only, never email.

**Sign-out forgets the phone.** Signing out, from Settings or by switching
servers, asks the server to delete this phone's token first (waiting at most
3 seconds). A phone deleted without signing out stops receiving pushes when
Expo reports the token dead.

**Over-the-air updates split by version after this.** 1.7.0 has its own runtime
version, so an OTA published for 1.7.0 does not reach 1.6.0 phones, and the
push code cannot reach 1.6.0 phones over the air at all (it needs the native
module in this build). Publish fixes once per live runtime version (see
EAS-UPDATE.md).

**App Review.** Notifications are requested only after the person taps "Turn on
notifications" in Settings, Notifications. A reviewer on a free plan sees the
switches disabled with a note that push is not included in their workspaces'
plans; give them an account on a paid workspace to see the full flow.
