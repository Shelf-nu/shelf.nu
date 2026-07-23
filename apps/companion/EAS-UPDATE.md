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

## Code signing (required — the client verifies every bundle)

OTA without code signing means the app trusts **any** bundle the EAS endpoint
serves, so a compromised EAS account or CI token could push malicious JS to
every install silently. Code signing closes that: the app embeds a public
**certificate** and refuses any update not signed by the matching **private
key**.

- `app.json` → `updates.codeSigningCertificate` + `codeSigningMetadata`.
- `ios/Shelf/Supporting/Expo.plist` → `EXUpdatesCodeSigningCertificate` (PEM
  inline) + `EXUpdatesCodeSigningMetadata` (bare iOS reads the plist, not
  app.json).
- Public certificate: `certs/certificate.pem` — committed, embedded in the app.
- Private key: `keys/private-key.pem` — **gitignored, never committed.**

Publish signs with the private key:

```bash
eas update --channel production --message "fix: … (#PR)" \
  --private-key-path ./keys/private-key.pem
```

### 🔑 Key custody — do this before the first production OTA build

The whole point is that an **EAS-account compromise can't sign updates**. So:

1. **Regenerate the key pair yourself** — the committed cert/key were generated
   in an automated session and must not be trusted for production:
   ```bash
   cd apps/companion
   npx expo-updates codesigning:generate \
     --key-output-directory keys --certificate-output-directory certs \
     --certificate-validity-duration-years 10 \
     --certificate-common-name "Shelf Companion"
   npx expo-updates codesigning:configure \
     --certificate-input-directory=certs --key-input-directory=keys
   ```
   Then re-add the new cert to `Expo.plist` (the `EXUpdatesCodeSigning*` keys)
   and commit the new `certs/certificate.pem`.
2. **Store the private key in a secrets manager / CI secret — NOT in the EAS
   account and NOT in the repo.** Whoever runs `eas update` pulls it at publish
   time via `--private-key-path`.
3. **Rotate** if the key is ever exposed: generate a new pair, cut a new build
   with the new certificate. Old builds keep trusting the old cert until users
   update the binary, so treat a leak as build-worthy.
