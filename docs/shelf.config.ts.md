# shelf.config.ts

This file has a few configuration options, that are used to adjust and disable certain functionalities.

```ts
// remix.config.ts
import { ENABLE_PREMIUM_FEATURES } from "~/utils/env";
import { Config } from "./types";

export const config: Config = {
  sendOnboardingEmail: SEND_ONBOARDING_EMAIL || false,
  enablePremiumFeatures: ENABLE_PREMIUM_FEATURES || false,
};
```

## sendOnboardingEmail

This flag allows you to choose whether the onboarding email will be sent to new users. Email is being sent within the action of `routes/_welcome+/onboarding.tsx`
Default value is false. If you want to override it you can use the env variable `SEND_ONBOARDING_EMAIL`

```ts
//remix.config.ts
// Default
sendOnboardingEmail: true;
```

## enablePremiumFeatures

Choose whether you want premium features to be enabled. Setting this to false will allow your users to use all features of shelf, without limitations.

```ts
//remix.config.ts
// Default
enablePremiumFeatures: ENABLE_PREMIUM_FEATURES || false;
```

You will notice the value comes from an env variable. This is the default functionality and allows you to have a different config on different servers, however if you don't care about it, you can simply set it to `true` or `false`.
