import { ENABLE_PREMIUM_FEATURES } from "~/utils";
import { Config } from "./types";

export const config: Config = {
  sendOnboardingEmail: true,
  enablePremiumFeatures: ENABLE_PREMIUM_FEATURES || false,
};
