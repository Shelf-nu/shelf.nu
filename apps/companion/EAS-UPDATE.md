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

`app.json` sets `runtimeVersion` equal to the app version, by hand — it reads
`1.5.0` today, and every store cut bumps it (see
[STORE-RELEASE.md](./STORE-RELEASE.md) for the six places that must agree). An
update only reaches builds whose **runtime version matches**, and only on the
**channel** it was published to (see Channels below). So an update published to
`production` for the current runtime reaches the **update-capable** production
builds on that exact version (ones that accept an unsigned bundle; the
pre-`expo-updates` binaries — every store build up to and including 1.2.0 —
can't check for updates at all), and is ignored by builds on any other runtime
until you publish for theirs. This is the safety net: JS that assumes new
native code can never land on a build that lacks it.

**A store cut resets this.** Bumping the runtime to a new version means nothing
previously published reaches the new builds, so the first update for a release
has to be published against its own runtime version.

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
#    --clear is REQUIRED, not tidiness: Metro caches transformed modules keyed
#    on file content alone, so a cached module keeps the EXPO_PUBLIC_* values
#    that were inlined when it was cached. Without it, `eas env:exec production`
#    is silently ignored and the last environment to bundle in this tree wins.
eas env:exec production "npx expo export --clear --dump-sourcemap -p ios -p android"

# 1b. GATE — prove the artifact before step 2 publishes it. Reads the baked
#     values back out of the built bundles and exits non-zero on a mismatch, so
#     a copy-pasted run cannot sail past it. Run under the SAME environment the
#     export claimed, so expected and baked values arrive the same way.
eas env:exec production "node scripts/check-bundle-env.mjs"

# 2. Publish exactly that bundle. --skip-bundler is what makes this safe: it
#    guarantees the artifact published here is byte-identical to the one
#    exported under the production environment in step 1, which is also the
#    artifact step 3's source maps describe. Without it eas re-bundles, and
#    the three steps can disagree about what shipped.
eas update --channel production --skip-bundler --input-dir dist \
  --message "fix: <what changed> (#PR)"

# 3. Upload the maps for the bundle that just shipped. All four vars are
#    required: the app.json Sentry plugin is a bare string, so the uploader
#    cannot read org/project from it and exits 1 without them.
SENTRY_AUTH_TOKEN=<token> SENTRY_ORG=<org> SENTRY_PROJECT=<project> \
  SENTRY_URL=https://sentry.io/ \
  npx sentry-expo-upload-sourcemaps dist
```

This is THE canonical publish procedure — every flag matters.

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
> shipped. Exporting without the production environment is what bakes wrong
> `EXPO_PUBLIC_*` values into a bundle that then reaches live users.
>
> **`eas env:exec production` alone does not guarantee this.** Metro's transform
> cache is keyed on file content, not on the environment, so a module cached by
> an earlier bundle keeps the values inlined then. Running the export without
> `--clear` in a tree that has bundled under any other environment — a dev
> server, a local `expo export`, an e2e run — reproduces that earlier
> environment's values and reports success. This is why step 1 carries `--clear`
> and step 1b reads the values back out of the artifact.
>
> Only `EXPO_PUBLIC_API_URL` has a backstop: `lib/api/client.ts` falls back to
> `https://app.shelf.nu` outside `__DEV__`, and only when the variable is UNSET,
> not when it is set to something wrong. `lib/supabase.ts` has none — it reads
> `EXPO_PUBLIC_SUPABASE_URL` / `_ANON_PUBLIC` with non-null assertions and builds
> the client at module scope. A bundle carrying the wrong Supabase project points
> every updated device at that project, where the session it holds was never
> minted and will not validate. Step 1b is the only thing standing between that
> and every live install.

Users get it on the **next app launch**: the running app launches instantly from
its cached bundle (`fallbackToCacheTimeout: 0`) and downloads the new bundle in
the background, applying it on the launch after that. No review, no store wait.

Verify what's live: `eas update:list --branch production` (check the **runtime
version** column, not just the message).
**Rolling back.**

```bash
# Send installs back to the bundle embedded in their build:
eas update:roll-back-to-embedded --channel production

# Or re-publish a known-good earlier update:
eas update:republish --channel production
```

Republish from a commit carrying the **same version** as the bad update, or the
rollback lands on a different runtime version and reaches nobody.

## ⚠️ Activation cost — this needs ONE build first

OTA needs two things in the installed binary, and both are compiled in:

| Requirement                | First build that has it |
| -------------------------- | ----------------------- |
| `expo-updates` present     | 1.3.0 (build 32)        |
| accepts an unsigned bundle | **1.4.0**               |

1.2.0 and earlier predate `expo-updates` entirely. 1.3.x has it but embeds a
signing certificate and refuses anything unsigned, which this account cannot
produce (see the code-signing section). So **1.4.0 is the first build that can
actually receive an update**, and no 1.3.x install can ever be reached over the
air — those users need a store update.

From 1.4.0 onward, every JS-only fix on that app version ships free via
`eas update`.

## Code signing (off — and why)

Updates are published **unsigned**. `eas update` takes no key, and the app
accepts any bundle the EAS endpoint serves for its channel and runtime version.

The reason is a plan boundary, not a preference: **EAS Update code signing is
sold only on the Enterprise plan**, and this account is on Starter. Attempting a
signed publish fails at the signing step with

```text
EAS Update code signing requires a subscription to the EAS Enterprise plan.
```

and — the trap worth knowing — **the update group is created before signing
runs**. A failed signed publish leaves an unsigned group sitting on the channel.
After any failed publish, check and clean up:

```bash
eas update:list --branch production
eas update:delete <group-id>
```

### What this costs

The EAS account is the **only** trust boundary for every install. Anyone who can
run `eas update` against this project can execute JavaScript inside the app on
every phone, with the signed-in user's session, bypassing Apple and Google
review. Two-factor authentication on the Expo account is therefore not optional
housekeeping — it is the control that replaced the signature.

Keep access tokens at zero unless a CI job genuinely needs one, and prefer a
robot user scoped to this project over a personal token.

### Reinstating it

`certs/certificate.pem` is still committed and still valid, so signing can be
turned back on without generating anything new:

1. Restore `updates.codeSigningCertificate` and `updates.codeSigningMetadata`
   in `app.json`, and the matching `EXUpdatesCodeSigningCertificate` /
   `EXUpdatesCodeSigningMetadata` keys in `ios/Shelf/Supporting/Expo.plist`.
2. Cut a new store build. The setting is compiled in, so it only governs builds
   made after the change — it cannot be applied over the air.
3. Publish with `--private-key-path <key>`, which requires the Enterprise plan.

The private key is held outside the repo and pairs with the committed
certificate (SHA-256 `41:AD:C3:E7:31:31:3E:5B:6D:72:81:69:3D:CC:38:19:E9:B0:C5:E5:D8:58:9D:02:3B:05:2E:E9:CB:5E:FB:78`).
Never rotate the certificate to fix a key problem: installs verify against the
certificate they shipped with, so a rotation strands every existing install
until it takes a new store build.
