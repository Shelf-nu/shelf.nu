/**
 * Client identity for API requests.
 *
 * Builds the User-Agent the app sends on every API call so scan records
 * (and server logs) can attribute traffic to the app instead of showing
 * "Unknown device". Format, parsed by the webapp's scan panel:
 *
 *   ShelfCompanion/<appVersion> (<device>; <os>)
 *   e.g. ShelfCompanion/1.3.0 (iPhone; iOS 18.6)
 *        ShelfCompanion/1.3.0 (google Pixel 8; Android 14)
 *
 * Deliberately built ONLY from modules already present in the shipped
 * binary (react-native Platform + expo-constants) so this change stays
 * deliverable over-the-air. Carries no identifiers beyond device class,
 * OS version and app version — the same information any browser UA leaks.
 *
 * @see apps/webapp/app/modules/scan/utils.server.ts (parseCompanionUserAgent)
 */
import Constants from "expo-constants";
import { Platform } from "react-native";

/** Reads the app version the same way the Settings screen does. */
function appVersion(): string {
  return (
    Constants.expoConfig?.version ??
    Constants.manifest2?.extra?.expoClient?.version ??
    "unknown"
  );
}

/**
 * Builds the User-Agent string for this device, or null on web builds —
 * browsers treat User-Agent as a forbidden header and must keep their own.
 */
export function buildClientUserAgent(): string | null {
  if (Platform.OS === "web") return null;

  let device: string;
  let os: string;
  if (Platform.OS === "ios") {
    device = Platform.isPad ? "iPad" : "iPhone";
    os = `iOS ${Platform.Version}`;
  } else {
    const constants = Platform.constants as {
      Brand?: string;
      Model?: string;
      Release?: string;
    };
    device =
      [constants.Brand, constants.Model].filter(Boolean).join(" ") || "Android";
    os = `Android ${constants.Release ?? Platform.Version}`;
  }

  return `ShelfCompanion/${appVersion()} (${device}; ${os})`;
}

/** Computed once at module load — device identity cannot change at runtime. */
export const CLIENT_USER_AGENT = buildClientUserAgent();
