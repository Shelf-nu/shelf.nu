---
description: Adding a Companion deep-linkable route (Universal Links / App Links) requires updating the allowlist in THREE places that must stay in sync — plus the screen must exist. Never claim the whole domain, and never hand a claimed path back to the OS via Linking.openURL.
globs:
  [
    "apps/webapp/app/routes/*well-known*",
    "apps/companion/app.json",
    "apps/companion/lib/deep-links.ts",
    "apps/companion/app/**/*.tsx",
  ]
---

# Companion Deep-Link Allowlist Consistency

`https://app.shelf.nu/...` links open the Companion app (not the web) only for
an explicit path allowlist. That allowlist is declared in **three places** and
they MUST stay in sync. Touch one → check the other two.

| #   | File                                                                  | What to add for a new route (e.g. `/locations`)                                        |
| --- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1   | `apps/webapp/app/routes/[.well-known].apple-app-site-association.tsx` | a `{ "/": "/locations/*" }` entry in `DEEP_LINK_COMPONENTS` (iOS)                      |
| 2   | `apps/companion/app.json` → `android.intentFilters[].data`            | `{ "scheme": "https", "host": "app.shelf.nu", "pathPrefix": "/locations/" }` (Android) |
| 3   | `apps/companion/lib/deep-links.ts`                                    | a `case "locations":` in BOTH `parseDeepLink` and `navigateToLink`                     |

**Prerequisite:** the destination screen must already exist (e.g.
`apps/companion/app/(tabs)/locations/[id].tsx`) and be reachable via
`pushIntoTab` — anchored navigation, or the back button strands the user
(App Store Guideline 2.1).

**Rollout:** #1 ships with a normal webapp deploy. #2 and #3 live in the native
binary → require a new app build + store submission (no OTA).

## Two hard rules — getting these wrong is a production incident

❌ **Never claim the whole domain / never add an auth path.** Do not use a `/*`
wildcard and never list `/login`, `/oauth*`, `/sso-login`, `/forgot-password`,
`/join`, `/accept-invite*`, `/otp`, `/send-otp`, `/resend-otp`, `/logout`. The
OS would hijack those links into the app, which has no screen for them →
breaks web login / password reset / invites for everyone with the app.

❌ **Never `Linking.openURL` a claimed path.** A web-fallback to a claimed URL
(e.g. `https://app.shelf.nu/qr/...`) is re-intercepted by Android App Links and
re-opens the app → infinite loop. Use `openShelfWebUrl()` (`lib/navigation.ts`,
in-app browser) instead.

✅ Allowlist mirrors a real native screen, is path-scoped (trailing slash so
index pages aren't claimed), and falls back to the web via `openShelfWebUrl`.
