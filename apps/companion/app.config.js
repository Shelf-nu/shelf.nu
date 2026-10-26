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
 * The field is left unset when neither exists: Expo's Android plugin copies
 * the file during prebuild and aborts when the path points nowhere, which
 * would block `expo run:android` for anyone who is not testing push. Without
 * the file the app builds and runs, and push registration is unavailable.
 *
 * @see {@link file://./PUSH-NOTIFICATIONS.md}
 */
const fs = require("fs");
const path = require("path");

const LOCAL_GOOGLE_SERVICES = "./google-services.json";

/** The Firebase file to build with, or undefined when there is none. */
function googleServicesFile() {
  if (process.env.GOOGLE_SERVICES_JSON) return process.env.GOOGLE_SERVICES_JSON;
  return fs.existsSync(path.join(__dirname, LOCAL_GOOGLE_SERVICES))
    ? LOCAL_GOOGLE_SERVICES
    : undefined;
}

module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    googleServicesFile: googleServicesFile(),
  },
});
