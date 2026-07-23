# Over-the-air updates (EAS Update)

The companion ships JS/asset-only fixes **without a store build** via EAS Update.
A native change still needs a build; an OTA update patches the JavaScript bundle
of an already-installed build.

## What can and can't go OTA

| Ship over-the-air (`eas update`)           | Needs a new build (`eas build`)              |
| ------------------------------------------ | -------------------------------------------- |
| React/TS changes, styles, copy             | New native dependency / native module        |
| New screens, navigation, business logic    | Permission / capability / entitlement change |
| Asset (image/font) swaps                   | `app.json` native config, config plugins     |
| Bug fixes in `app/`, `components/`, `lib/` | App version bump (new `runtimeVersion`)      |

If in doubt: touched only files under `apps/companion/{app,components,lib,...}`
→ OTA. Touched `ios/`, `android/`, `app.json` native keys, or added a dep → build.

## Runtime version = app version

`app.json` sets `runtimeVersion: { policy: "appVersion" }`. An OTA update only
reaches builds whose **app version matches**. So an update published while the
app is `1.2.0` reaches every `1.2.0` build, and is ignored by a future `1.3.0`
build until you publish an update for `1.3.0`. This is the safety net: JS that
assumes new native code can never land on a build that lacks it.

> **iOS version now lives in FOUR spots** — bump all together on a release:
> `app.json` `version`, `ios/Shelf/Info.plist` `CFBundleShortVersionString`,
> `ios/Shelf.xcodeproj/project.pbxproj` `MARKETING_VERSION` (×2), and
> `ios/Shelf/Supporting/Expo.plist` `EXUpdatesRuntimeVersion`. EAS Build
> re-resolves the last one from the `appVersion` policy, but keep it in sync so
> local/`expo run` builds match.

## Channels

`eas.json` maps each build profile to a channel of the same name:

| Profile       | Channel       | Audience                      |
| ------------- | ------------- | ----------------------------- |
| `production`  | `production`  | App Store / Play (live users) |
| `preview`     | `preview`     | internal-distribution builds  |
| `development` | `development` | dev-client builds             |

A build listens on its channel; `eas update --channel <name>` publishes to it.

## Publishing an update

```bash
cd apps/companion
# JS-only fix already merged to main and checked out:
eas update --channel production --message "fix: <what changed> (#PR)"
```

Users get it on the **next app launch**: the running app launches instantly from
its cached bundle (`fallbackToCacheTimeout: 0`) and downloads the new bundle in
the background, applying it on the launch after that. No review, no store wait.

Verify what's live: `eas update:list --branch production`.
Roll back: republish the previous good commit, or `eas update:roll-back-to-embedded`.

## ⚠️ Activation cost — this needs ONE build first

OTA only works on builds that were **built with `expo-updates` in them**. The
live 1.2.0 store builds predate this, so they can **not** receive OTA. The first
build cut after this change (build 32+) is the first OTA-capable one. From that
build onward, every JS-only fix on that app version ships free via `eas update`.

So: merge this → cut one more build (the last "paid" one for a while) → publish
JS fixes over the air after that.
