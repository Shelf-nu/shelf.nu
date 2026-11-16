# Cutting a companion store build

How a version of the app reaches the App Store and Google Play. For shipping
JavaScript to installs that already exist, see [EAS-UPDATE.md](./EAS-UPDATE.md)
instead — this document is the binary.

## Before you start

- `eas whoami` returns an account with access to the Shelf project.
- `apps/companion/google-service-account.json` exists. It is git-ignored and
  holds the Play submission key; without it the Android submit fails.
- Push credentials are in place on EAS (APNs key, FCM V1 service account) and
  `ios/Shelf/Shelf.entitlements` still carries `aps-environment`. See
  [PUSH-NOTIFICATIONS.md](./PUSH-NOTIFICATIONS.md).
- The `GOOGLE_SERVICES_JSON` file variable exists on EAS for the `production`
  environment (`eas env:list --environment production`). `app.config.js` reads
  it into `expo.android.googleServicesFile`; without it Android installs never
  register for push. The file is not in git (it carries a Firebase client key).
- Everything intended for this release is merged to `main`.
- App Store Connect has screenshots for 13-inch iPad displays. The iOS build
  targets iPad as well as iPhone (`supportsTablet` in `app.json`), so App Store
  Connect will not send a version to review without them. Uploaded screenshots
  carry over to later versions.

## 1. The version bump

The version lives in **six declarations across four files**, and the runtime
version is a hand-written literal because iOS is the bare workflow — nothing
derives it. `scripts/check-version-sync.mjs` asserts all six agree and runs as
part of `pnpm --filter @shelf/companion lint`, so CI fails a PR that misses one.

| File                                  | Declaration                   |
| ------------------------------------- | ----------------------------- |
| `app.json`                            | `expo.version`                |
| `app.json`                            | `expo.runtimeVersion`         |
| `ios/Shelf/Info.plist`                | `CFBundleShortVersionString`  |
| `ios/Shelf.xcodeproj/project.pbxproj` | `MARKETING_VERSION` (Debug)   |
| `ios/Shelf.xcodeproj/project.pbxproj` | `MARKETING_VERSION` (Release) |
| `ios/Shelf/Supporting/Expo.plist`     | `EXUpdatesRuntimeVersion`     |

Bump them in a release PR rather than on the day, so the change is reviewed and
CI proves the six agree:

```bash
node apps/companion/scripts/check-version-sync.mjs
```

**Build numbers are not in this repo.** `eas.json` sets
`cli.appVersionSource: "remote"` and `build.production.autoIncrement: true`, so
EAS holds the iOS build number and the Android version code and increments them
itself. Do not edit `CFBundleVersion` or add `android.versionCode`.

## 2. Write the release notes

Add `RELEASE-NOTES-<version>.md` beside the previous one. It carries the App
Store text, a Google Play version under 500 characters, and an internal section
for behaviour worth knowing that does not belong in a store listing.

Write the notes from what is an **ancestor of the build commit**, not from what
was merged that week — a change that lands days before the cut can still miss
it. Check each claim:

```bash
git merge-base --is-ancestor <feature-commit> <build-commit> && echo shipped
```

## 3. Build

From `apps/companion`, on the merged release commit:

```bash
eas build --platform all --profile production
```

The `production` profile builds both platforms against the `production` channel.
Watch it to completion — a failure here is cheaper to fix than a rejected
submission.

## 4. Submit

```bash
eas submit --platform ios --profile production
```

```bash
eas submit --platform android --profile production
```

Credentials come from `eas.json`: App Store app id `6765639874`, Apple team
`27Q4MHFB8K`; Play uploads to the `production` track with
`releaseStatus: "draft"`, so Play never publishes on its own — someone releases
it deliberately.

## 5. App Review notes

Anything a reviewer cannot reach on their own has to be written down, or the
submission is rejected as incomplete rather than refused on its merits.

Private-server sign-in is the current example. A reviewer cannot exercise it
without a domain registered in the server registry and an account on that
server — credentials for Shelf Cloud do not work there, because each server is a
separate Supabase project. The review notes need:

- What the feature is for, and that Shelf Cloud is the default
- The exact domain to type
- Credentials on **that** server
- The steps: sign-in screen → Connect to a private server → type the domain →
  sign in → Settings → Server → Disconnect

Check `disablePasswordLogin` is false for whichever domain you give them.
When it is true the reviewer only sees single sign-on, which hands off to an
identity provider they cannot pass, and a working feature looks like a dead end.
