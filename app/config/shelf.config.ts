import {
  DISABLE_SIGNUP,
  DISABLE_SSO,
  ENABLE_PREMIUM_FEATURES,
  SEND_ONBOARDING_EMAIL,
} from "~/utils/env";
import { Config } from "./types";

export const config: Config = {
  sendOnboardingEmail: SEND_ONBOARDING_EMAIL || false,
  enablePremiumFeatures: ENABLE_PREMIUM_FEATURES || false,
  disableSignup: DISABLE_SIGNUP || false,
  disableSSO: DISABLE_SSO || false,

  logoPath: {
    fullLogo: "/static/images/logo-full-color(x2).png",
    symbol: "/static/images/shelf-symbol.png",
  },
  faviconPath: "/static/favicon.ico",
  emailPrimaryColor: "#EF6820",
};
