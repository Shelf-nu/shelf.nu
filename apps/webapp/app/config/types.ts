export interface Config {
  /**
   * Enable sending of onboarding email.
   * Email gets sent when user is onboarded and we have their first and last name
   * */
  sendOnboardingEmail: boolean;

  /**
   * Number of days for the free trial
   */
  freeTrialDays: number;

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

  /**
   * Show the "How did you find us?" field in the onboarding process
   * This is useful for gathering feedback on how users discover the platform.
   * @deprecated Use collectBusinessIntel instead. Kept for backwards compatibility.
   */
  showHowDidYouFindUs: boolean;

  /**
   * Collect business intelligence data during onboarding
   * When enabled, shows additional fields like role, team size, company name, etc.
   * If COLLECT_BUSINESS_INTEL is not set, falls back to SHOW_HOW_DID_YOU_FIND_US for backwards compatibility.
   */
  collectBusinessIntel: boolean;

  /**
   * Geocoding configuration
   */
  geocoding: {
    /**
     * User-Agent string for geocoding requests
     * Used to identify the application to the geocoding service
     */
    userAgent: string;
  };
}
