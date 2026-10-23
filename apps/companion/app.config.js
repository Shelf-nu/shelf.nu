/**
 * Expo app config.
 *
 * `app.json` holds the static configuration and stays the single source the
 * release scripts read (`scripts/check-version-sync.mjs` parses it as JSON).
 * This file layers on the values that depend on where the build runs.
 *
 * `GOOGLE_SERVICES_JSON` is an EAS file environment variable holding the
 * Firebase client configuration for Android (`google-services.json`). EAS
 * resolves it to a path at build time. A local build falls back to a
 * gitignored copy next to this file; see PUSH-NOTIFICATIONS.md for where that
 * copy comes from and why it is not committed.
 *
 * @see {@link file://./PUSH-NOTIFICATIONS.md}
 */
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    googleServicesFile:
      process.env.GOOGLE_SERVICES_JSON ?? "./google-services.json",
  },
});
