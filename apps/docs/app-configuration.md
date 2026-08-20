# App configuration - shelf.config.ts

This file contains configuration options that are used to adjust and disable certain functionalities in Shelf.nu.

```ts
// shelf.config.ts
import {
  DISABLE_SIGNUP,
  DISABLE_SSO,
  ENABLE_PREMIUM_FEATURES,
  FREE_TRIAL_DAYS,
  SEND_ONBOARDING_EMAIL,
} from "~/utils/env";
import { Config } from "./types";

export const config: Config = {
  sendOnboardingEmail: SEND_ONBOARDING_EMAIL || false,
  enablePremiumFeatures: ENABLE_PREMIUM_FEATURES || false,
  freeTrialDays: Number(FREE_TRIAL_DAYS || 7),
  disableSignup: DISABLE_SIGNUP || false,
  disableSSO: DISABLE_SSO || false,
  logoPath: {
    fullLogo: "/static/images/logo-full-color(x2).png",
    symbol: "/static/images/shelf-symbol.png",
  },
  faviconPath: "/static/favicon.ico",
  emailPrimaryColor: "#EF6820",
  showHowDidYouFindUs: SHOW_HOW_DID_YOU_FIND_US || false,
};
```

## Configuration Options

### sendOnboardingEmail

This flag controls whether the onboarding email will be sent to new users. The email is sent within the action of `routes/_welcome+/onboarding.tsx`.

**Default value:** `false`  
**Environment variable:** `SEND_ONBOARDING_EMAIL`

```ts
// Enable onboarding emails
sendOnboardingEmail: true;
```

### enablePremiumFeatures

Choose whether you want premium features to be enabled. Setting this to `false` will allow your users to use all features of Shelf without limitations.

**Default value:** `false`  
**Environment variable:** `ENABLE_PREMIUM_FEATURES`

```ts
// Enable premium features
enablePremiumFeatures: true;
```

You can set this directly in the config file or use the environment variable to have different configurations on different servers.

### collectBusinessIntel

Controls whether business intelligence fields are collected during user onboarding. When enabled, users are asked to provide:

- How they heard about Shelf (referral source)
- Their role
- Team size
- Company/Organization name (for self-serve signups)
- Optional customization questions (primary use case, current solution, timeline)

When a user selects "Personal use" as their role, the team size and company name fields are automatically hidden.

**Default value:** `false`
**Environment variable:** `COLLECT_BUSINESS_INTEL`

```ts
// Enable business intelligence collection
collectBusinessIntel: true;
```

**Backwards Compatibility:** If `COLLECT_BUSINESS_INTEL` is not set, it falls back to `SHOW_HOW_DID_YOU_FIND_US` for compatibility with existing configurations.

### showHowDidYouFindUs

> **⚠️ Deprecated:** Use `collectBusinessIntel` instead. This option is kept for backwards compatibility.

Choose whether an open field will be shown on the onboarding page, asking the user to provide info on how they found out about Shelf.

**Default value:** `false`
**Environment variable:** `SHOW_HOW_DID_YOU_FIND_US`

### freeTrialDays

Sets the number of days for the free trial period when premium features are enabled.

**Default value:** `7`  
**Environment variable:** `FREE_TRIAL_DAYS`

```ts
// Set 14-day free trial
freeTrialDays: 14;
```

### disableSignup

Prevents new users from signing up to your Shelf instance. Useful for closed/private instances.

**Default value:** `false`  
**Environment variable:** `DISABLE_SIGNUP`

```ts
// Disable new user registrations
disableSignup: true;
```

### disableSSO

Disables Single Sign-On functionality even if SSO providers are configured.

**Default value:** `false`  
**Environment variable:** `DISABLE_SSO`

```ts
// Disable SSO login
disableSSO: true;
```

### enableScim

Enables SCIM 2.0 user provisioning, so an identity provider (Microsoft Entra ID,
Okta) can create, update and deactivate users in a workspace automatically.

Unlike the other flags this one is **opt-in** — SCIM stays off unless you
explicitly enable it. While disabled, the SCIM API responds `404` and the SCIM
section in workspace settings is hidden.

Requires SSO to be configured on the workspace: SCIM only provisions users whose
email domain matches the workspace's verified SSO domain.

> Not currently available on Shelf Cloud. Self-hosted deployments can enable it.

**Default value:** `false`  
**Environment variable:** `ENABLE_SCIM`

```ts
// Enable SCIM provisioning
enableScim: true;
```

### logoPath

Defines the paths to your application logos. These are used throughout the application interface.

**Default values:**

- `fullLogo`: `"/static/images/logo-full-color(x2).png"`
- `symbol`: `"/static/images/shelf-symbol.png"`

```ts
// Custom logo paths
logoPath: {
  fullLogo: "/static/images/my-custom-logo.png",
  symbol: "/static/images/my-symbol.png",
}
```

### faviconPath

Path to your application's favicon.

**Default value:** `"/static/favicon.ico"`

```ts
// Custom favicon
faviconPath: "/static/my-favicon.ico";
```

### emailPrimaryColor

Primary color used in email templates and notifications.

**Default value:** `"#EF6820"` (Shelf orange)

```ts
// Custom email color
emailPrimaryColor: "#FF5733";
```

## Environment Variables

You can override any of these settings using environment variables:

```bash
# .env file
SEND_ONBOARDING_EMAIL=true
ENABLE_PREMIUM_FEATURES=false
FREE_TRIAL_DAYS=14
DISABLE_SIGNUP=false
DISABLE_SSO=false
ENABLE_SCIM=false
COLLECT_BUSINESS_INTEL=true
# SHOW_HOW_DID_YOU_FIND_US=true  # Deprecated, use COLLECT_BUSINESS_INTEL instead
```

## Companion app multi-server support

The Companion mobile app connects to one Shelf server at a time and picks which
one from the domain of the email the user types at login. Two environment
variables drive that.

### `INSTANCE_NAME`

Human-readable name of this instance, served on `GET /api/mobile/config` and
shown in the app as "Connected to \<name\>". Optional — defaults to `"Shelf"`.

```bash
INSTANCE_NAME="Acme University"
```

### `MIN_COMPANION_VERSION`

Lowest Companion app version this instance accepts, e.g. `"1.4.0"`. Optional —
unset means any version.

```bash
MIN_COMPANION_VERSION="1.4.0"
```

An app older than this is shown a blocking **Update Shelf** prompt with a store
link, instead of being allowed to connect and fail with confusing 4xx errors.
Set it when a breaking `/api/mobile/*` change ships.

This is the counterpart to `mobileApiVersion`, which guards the other direction
(a server too old for the app). Both checks exist because neither side can
update the other: the app cannot upgrade the server, and the server cannot
upgrade an installed app.

The comparison is numeric per segment, so `1.10.0` correctly outranks `1.9.0`,
and it **fails open** — a typo here can never lock users out of a working app.

### `COMPANION_SERVERS`

**Shelf Cloud only** — leave unset on self-hosted instances.

A JSON object mapping a lowercased email domain to the base URL of the Shelf
instance those users belong to. The app posts a domain to
`POST /api/mobile/resolve-server` at login and connects to whatever comes back,
so onboarding a customer is an environment change with **no app release**.

```bash
COMPANION_SERVERS='{"acme.edu":"https://acme.i.shelf.nu","acme.com":"https://acme.i.shelf.nu"}'
```

Rules:

- Values **must** be `https://`. Non-https entries are ignored, and the domain
  resolves as if it were absent.
- A domain that is absent (or a malformed value anywhere in the JSON) resolves
  to Shelf Cloud. The registry fails open by design — a bad value must never
  block sign-in for cloud users.
- The variable is treated as a **secret**: it is never included in the
  browser-side `window.env`, because the mapping reveals which organisations
  run self-hosted Shelf.
- Multiple domains may point at the same instance (see the example above).

Read only by `app/modules/api/companion-servers.server.ts`. When the registry
eventually needs per-entry expiry or revocation, that one file changes.

## Notes

- Changes to this file require a server restart to take effect
- Environment variables take precedence over hardcoded values
- Logo and favicon paths are relative to the `public` directory
- Email colors should be in hex format (`#RRGGBB`)
