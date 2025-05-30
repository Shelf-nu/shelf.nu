import {
  DISABLE_SIGNUP,
  DISABLE_SSO,
  ENABLE_PREMIUM_FEATURES,
  FREE_TRIAL_DAYS,
  SEND_ONBOARDING_EMAIL,
  SUPPORTED_LANGUAGES,
  FALLBACK_LANGUAGE,

} from "~/utils/env";
import { Config } from "./types";


export const config: Config = {
  SUPPORTED_LANGUAGES: SUPPORTED_LANGUAGES || ["en", "fr"],
  FALLBACK_LANGUAGE: FALLBACK_LANGUAGE || "en",
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
};
