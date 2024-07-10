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

  /**
   * Disable the signup functionality
   * Set this to true to disable user registration. New users will still be possible to be added via sending invites.
   * As a side effect of this, users will not get a personal workspace. This is because new accounts will only be possible to be created via invites.
   */
  disableSignup: boolean;

  /**
   * Disable SSO
   */
  disableSSO: boolean;
}
