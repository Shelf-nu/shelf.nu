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
 * When neither exists, `googleServicesFile` is left unset: the Android prebuild
 * plugin throws on a path it cannot copy, so naming a missing file would fail
 * the whole build. Without it the build succeeds and the app simply cannot
 * register for push.
 *
 * @see {@link file://./PUSH-NOTIFICATIONS.md}
 */
const fs = require("node:fs");
const path = require("node:path");

const LOCAL_GOOGLE_SERVICES_FILE = "./google-services.json";

/**
 * Picks the Firebase client config for Android: the EAS file variable, else
 * the local gitignored copy, else none.
 *
 * @returns {string | undefined} Path to `google-services.json`, or undefined when there is none
 */
function resolveGoogleServicesFile() {
  if (process.env.GOOGLE_SERVICES_JSON) return process.env.GOOGLE_SERVICES_JSON;
  const localPath = path.join(__dirname, LOCAL_GOOGLE_SERVICES_FILE);
  return fs.existsSync(localPath) ? LOCAL_GOOGLE_SERVICES_FILE : undefined;
}

module.exports = ({ config }) => {
  const googleServicesFile = resolveGoogleServicesFile();
  return {
    ...config,
    android: {
      ...config.android,
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
  };
};
