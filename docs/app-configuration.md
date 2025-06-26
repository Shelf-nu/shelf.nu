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

### showHowDidYouFindUs

Choose whether a open field will be shown on the onboarding page, asking the user to provide info how they found out about shelf.

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
```

## Notes

- Changes to this file require a server restart to take effect
- Environment variables take precedence over hardcoded values
- Logo and favicon paths are relative to the `public` directory
- Email colors should be in hex format (`#RRGGBB`)
