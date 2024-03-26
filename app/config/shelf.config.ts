import { ENABLE_PREMIUM_FEATURES, SEND_ONBOARDING_EMAIL } from "~/utils";
import { Config } from "./types";

export const config: Config = {
  sendOnboardingEmail: SEND_ONBOARDING_EMAIL || false,
  enablePremiumFeatures: ENABLE_PREMIUM_FEATURES || false,
};
