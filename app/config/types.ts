export interface Config {
  /**
   * Enable sending of onboarding email.
   * Email gets sent when user is onboarded and we have their first and last name
   * */
  sendOnboardingEmail: boolean;

  /**
   * Enable premium features
   */
  enablePremiumFeatures: boolean;
}
