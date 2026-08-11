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
→ OTA. Touched `ios/`, `android/`, `app.json` native keys, or added a **native**
dependency (one with an iOS/Android module) → build. A pure-JS dependency can
ride an OTA bundle.

## Runtime version = app version

`app.json` sets `runtimeVersion: "1.3.0"`, kept equal to the app version by
hand. An OTA update only reaches builds whose **runtime version matches**, and
only on the **channel** it was published to (see Channels below). So an update
published to `production` for runtime `1.3.0` reaches the **OTA-capable**
`1.3.0` production builds (ones built with `expo-updates`; the
pre-`expo-updates` binaries — every store build up to and including 1.2.0 —
can't check for updates at all), and is ignored by a future `1.4.0` build until
you publish an update for `1.4.0`. This is the safety net: JS that assumes new
native code can never land on a build that lacks it.

> **Why a hard-coded string and not `{ "policy": "appVersion" }`.** `ios/` is
> committed, so expo-updates classifies iOS as the **generic (bare)** workflow,
> where runtime-version policies are rejected outright:
> `npx expo-updates runtimeversion:resolve --platform ios` exits non-zero with
> _"You're currently using the bare workflow, where runtime version policies are
> not supported."_ That resolver is what `eas update` and `eas build` call, so a
> policy breaks **both** on iOS while Android (managed, since `android/` is
> absent) resolves fine. Do not "tidy" this back into a policy. Verify any
> change with
> `npx expo-updates runtimeversion:resolve --platform ios --workflow generic`.

> **The version now lives in SIX declarations** across four files. Bump all
> together on a release: `app.json` `version`, `app.json` `runtimeVersion`,
> `ios/Shelf/Info.plist` `CFBundleShortVersionString`,
> `ios/Shelf.xcodeproj/project.pbxproj` `MARKETING_VERSION` (×2, one per build
> config), and `ios/Shelf/Supporting/Expo.plist` `EXUpdatesRuntimeVersion`.
> `scripts/check-version-sync.mjs` enforces this on every `lint` run (and so in
> CI); it fails on drift **and** on a declaration going missing, so reverting
> `runtimeVersion` to a policy object also trips it.

## Channels

`eas.json` maps each build profile to a channel of the same name:

| Profile       | Channel       | Audience                      |
| ------------- | ------------- | ----------------------------- |
| `production`  | `production`  | App Store / Play (live users) |
| `preview`     | `preview`     | internal-distribution builds  |
| `development` | `development` | dev-client builds             |

A production/preview build listens on its own channel; `eas update --channel
<name>` publishes to it. Dev-client builds (`developmentClient: true`) are the
exception — they can load a compatible update from **any** channel via the
dev-client Extensions UI, so the `development` row is the default, not a hard
scope.

## Publishing an update

**Before you publish, check who you are publishing to.** `eas update` reports
success whether or not a single install can receive the bundle: it only uploads
against a runtime version. Confirm the runtime version you are about to publish
equals the version live in the stores (App Store / Play listing, or
`eas build:list --platform ios --limit 1`). `main` routinely carries a version
ahead of the stores (1.2.0 sat on main for 16 days while every install was
1.1.0), and publishing from main in that window reaches nobody while looking
like it worked. If the installed base spans two versions, publish once per live
runtime version, from the matching release tag rather than from `main`.

Three steps, in this order. JS-only fix already merged to main and checked out:

```bash
cd apps/companion

# 1. Bundle ONCE, under the production environment. EXPO_PUBLIC_* are inlined
#    HERE, not at publish time. Pin the platforms: `expo export` defaults to
#    ALL platforms including web, which EAS excludes from updates — exporting
#    it just ships a web bundle to Sentry in step 3.
eas env:exec production "npx expo export --dump-sourcemap -p ios -p android"

# 2. Publish exactly that bundle. --skip-bundler is what makes this safe: it
#    guarantees the artifact published here is byte-identical to the one
#    exported under the production environment in step 1, which is also the
#    artifact step 3's source maps describe. Without it eas re-bundles, and
#    the three steps can disagree about what shipped.
eas update --channel production --skip-bundler --input-dir dist \
  --message "fix: <what changed> (#PR)" \
  --private-key-path "$SHELF_OTA_PRIVATE_KEY"

# 3. Upload the maps for the bundle that just shipped. All four vars are
#    required: the app.json Sentry plugin is a bare string, so the uploader
#    cannot read org/project from it and exits 1 without them.
SENTRY_AUTH_TOKEN=<token> SENTRY_ORG=<org> SENTRY_PROJECT=<project> \
  SENTRY_URL=https://sentry.io/ \
  npx sentry-expo-upload-sourcemaps dist
```

This is THE canonical publish procedure — every flag matters. Set
`SHELF_OTA_PRIVATE_KEY` to wherever your copy of the signing key lives; it is
never in the repo (see key custody below).

**Why source maps are step 3 and not optional:** native builds upload theirs in
an Xcode build phase, which covers nothing that ships over the air. Skip step 3
and every crash in OTA'd code reaches Sentry as unreadable minified frames —
precisely when we are shipping blind hotfixes and most need to read them.

> **⚠️ Known gap, verify before trusting OTA symbolication.** `metro.config.js`
> uses Expo's `getDefaultConfig`, not Sentry's `getSentryExpoConfig`, so the
> bundle carries no `_sentryDebugIds` and step 3 passes no `--release`/`--dist`.
> The maps upload, but Sentry may not be able to associate them with events from
> OTA'd code. Fixing it means swapping the Metro config factory (keeping the
> `disableHierarchicalLookup` / `nodeModulesPaths` / `watchFolders` overrides)
> and re-cutting a build, so it is deliberately NOT bundled into the activation
> build. Track it before relying on OTA hotfix triage.

> **⚠️ The production environment is applied in step 1, not step 2 —
> `EXPO_PUBLIC_*` values are inlined at export time.** With `--skip-bundler`, an
> `--environment production` flag on `eas update` no longer influences what
> shipped. Exporting from a dev shell without the production environment is what
> bakes a wrong `EXPO_PUBLIC_API_URL` into a bundle that then reaches live users.
> `lib/api/client.ts` falls back to `https://app.shelf.nu` outside `__DEV__` so
> this can't strand users on localhost, but that is a backstop, not the
> mechanism — export under the production environment.

Users get it on the **next app launch**: the running app launches instantly from
its cached bundle (`fallbackToCacheTimeout: 0`) and downloads the new bundle in
the background, applying it on the launch after that. No review, no store wait.

Verify what's live: `eas update:list --branch production` (check the **runtime
version** column, not just the message).
**Rolling back.** Every command that publishes a directive needs the signing
key, not just `eas update` — with code signing enabled these fail immediately
without it, which is not what you want to discover mid-incident:

```bash
# Send installs back to the bundle embedded in their build:
eas update:roll-back-to-embedded --channel production \
  --private-key-path "$SHELF_OTA_PRIVATE_KEY"

# Or re-publish a known-good earlier update:
eas update:republish --channel production \
  --private-key-path "$SHELF_OTA_PRIVATE_KEY"
```

Republish from a commit carrying the **same version** as the bad update, or the
rollback lands on a different runtime version and reaches nobody.

## ⚠️ Activation cost — this needs ONE build first

OTA only works on builds that were **built with `expo-updates` in them**. Every
store build up to and including 1.2.0 predates `expo-updates`, so none of them
can receive OTA. The **1.3.0 build (build 32+) is the first OTA-capable one** —
it is the activation build. From that build onward, every JS-only fix on that
app version ships free via `eas update`.

So: cut the 1.3.0 build (the last "paid" one for a while) → publish JS fixes
over the air after that.

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

Publish signs with the private key (kept as a temporary untracked local copy or
injected by CI — see custody below). The command lives in the canonical publish
procedure at the top of this document — one copy, so the two can never drift.

### 🔑 Key custody

Only the **public certificate** (`certs/certificate.pem`) is committed and
embedded in the app. The **private key is never committed**: the `keys/`
directory is gitignored, and any local copy used to sign must stay untracked (or
be a CI-injected file). The whole point is that an **EAS-account compromise
can't sign updates**, so the private key must live outside EAS.

**Current pair (committed cert):** generated 2026-07-29, valid to 2036-07-29,
SHA1 `6A:70:1A:A1:70:F9:DA:F0:11:8F:EA:C7:E7:62:4C:AA:E5:2D:23:EA`. Generated by
the CTO on his own machine; the private key has never left it. This is the pair
the activation build (32+) embeds, so **do not rotate it again casually**: old
builds keep trusting the certificate they shipped with, so a rotation strands
every install until they update the binary. Rotating costs a build.

Ongoing rules:

1. **Store the private key in a secrets manager / CI secret, NOT in the EAS
   account and NOT in the repo.** Whoever runs `eas update` supplies it at
   publish time via `--private-key-path`.
2. **Rotate only when the key is exposed** (leaked, or ever tracked in git), and
   treat it as build-worthy work, not a config tweak:
   ```bash
   cd apps/companion
   npx expo-updates codesigning:generate \
     --key-output-directory keys --certificate-output-directory certs \
     --certificate-validity-duration-years 10 \
     --certificate-common-name "Shelf Companion"
   npx expo-updates codesigning:configure \
     --certificate-input-directory=certs --key-input-directory=keys
   ```
   `codesigning:configure` updates `app.json` only. You must **also** paste the
   new PEM into `ios/Shelf/Supporting/Expo.plist`
   (`EXUpdatesCodeSigningCertificate`), because bare iOS reads the plist, not
   `app.json`. Commit the new `certs/certificate.pem` **and** the plist, then cut
   a new build: until users install it, updates signed with the new key are
   rejected by every existing install.
