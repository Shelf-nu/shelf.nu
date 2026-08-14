---
description: Adding a Companion deep-linkable route (Universal Links / App Links) requires updating the allowlist in FOUR places that must stay in sync — plus the screen must exist. Never claim the whole domain, never hand a claimed path back to the OS via Linking.openURL, and every claimed prefix MUST have a +native-intent mapping or cold starts hang on the splash.
globs:
  [
    "apps/webapp/app/routes/*well-known*",
    "apps/companion/app.json",
    "apps/companion/lib/deep-links.ts",
    "apps/companion/app/**/*.tsx",
    "apps/companion/app/+native-intent.ts",
  ]
---

# Companion Deep-Link Allowlist Consistency

`https://app.shelf.nu/...` links open the Companion app (not the web) only for
an explicit path allowlist. That allowlist is declared in **four places** and
they MUST stay in sync. Touch one → check the other three.

| #   | File                                                                  | What to add for a new route (e.g. `/locations`)                                        |
| --- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1   | `apps/webapp/app/routes/[.well-known].apple-app-site-association.tsx` | a `{ "/": "/locations/*" }` entry in `DEEP_LINK_COMPONENTS` (iOS)                      |
| 2   | `apps/companion/app.json` → `android.intentFilters[].data`            | `{ "scheme": "https", "host": "app.shelf.nu", "pathPrefix": "/locations/" }` (Android) |
| 3   | `apps/companion/app/+native-intent.ts`                                | a `case "locations":` in `redirectSystemPath` mapping to a REAL native route           |
| 4   | `apps/companion/lib/deep-links.ts`                                    | a `case "locations":` in `parseDeepLink` + `navigateToLink` (custom-scheme links)      |

**Division of labour:** HTTPS universal links are routed natively by
expo-router via the `+native-intent.ts` rewrite (#3). The JS hook (#4) only
navigates custom-scheme links and resolves `/qr/:id` (async API call). Acting
on other HTTPS links in the JS hook double-navigates.

**Prerequisite:** the destination screen must already exist (e.g.
`apps/companion/app/(tabs)/locations/[id].tsx`) and be reachable via
`pushIntoTab` — anchored navigation, or the back button strands the user
(App Store Guideline 2.1).

**Rollout:** #1 ships with a normal webapp deploy. #2–#4 live in the native
binary → require a new app build + store submission (no OTA).

## Three hard rules — getting these wrong is a production incident

❌ **Never claim an HTTPS prefix without a `+native-intent` mapping.** The OS
delivers EVERY nested path under a claimed prefix (the canonical web asset URL
is `/assets/:id/overview`). Without a rewrite the router lands on an unmatched
route at cold start and the user hangs on the splash forever (the 1.1.0
build-25 bug). Deeper-nested paths map to the resource DETAIL screen — that is
what the tapper wants. `app/+not-found.tsx` redirects any remaining unmatched
route to the start screen as a last-resort net.

❌ **Never claim the whole domain / never add an auth path.** Do not use a `/*`
wildcard and never list `/login`, `/oauth*`, `/sso-login`, `/forgot-password`,
`/join`, `/accept-invite*`, `/otp`, `/send-otp`, `/resend-otp`, `/logout`. The
OS would hijack those links into the app, which has no screen for them →
breaks web login / password reset / invites for everyone with the app.

❌ **Never `Linking.openURL` a claimed path.** A web-fallback to a claimed URL
(e.g. `https://app.shelf.nu/qr/...`) is re-intercepted by Android App Links and
re-opens the app → infinite loop. Use `openShelfWebUrl()` (`lib/navigation.ts`,
in-app browser) instead — today only the QR not-resolvable fallback needs it.

✅ Allowlist mirrors a real native screen, is path-scoped (trailing slash so
index pages aren't claimed), has a `+native-intent` mapping for cold starts,
and web hand-offs go through `openShelfWebUrl`.
