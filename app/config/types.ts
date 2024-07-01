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

  /**
   * Logo paths
   * Used to override the default logo. Both values are required
   */
  logoPath?: {
    fullLogo: string;
    symbol: string;
  };

  /**
   * Primary color for emails
   */
  emailPrimaryColor: string;

  /**
   * Path to favicon
   */
  faviconPath: string;
}
