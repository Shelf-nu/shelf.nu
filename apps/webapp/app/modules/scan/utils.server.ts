import type { Qr, Scan, User, UserOrganization } from "@prisma/client";
import type { IResult } from "ua-parser-js";
import parser from "ua-parser-js";
import { ShelfError } from "~/utils/error";
import { resolveUserDisplayName } from "~/utils/user";

/**
 * The companion app identifies itself as
 * `ShelfCompanion/<appVersion> (<device>; <os>)`, e.g.
 * `ShelfCompanion/1.3.0 (iPhone; iOS 18.6)` or
 * `ShelfCompanion/1.3.0 (google Pixel 8; Android 14)`.
 * ua-parser-js cannot attribute that string, so scans from the app would
 * render as "Unknown device". @see apps/companion/lib/api/user-agent.ts
 */
const COMPANION_UA_REGEX = /^ShelfCompanion\/(\S+) \(([^;)]+); ([^)]+)\)$/;

/**
 * Recognizes the companion app's User-Agent and synthesizes the same
 * parsed shape ua-parser-js produces, so the scan panel renders
 * "Apple - iPhone / Shelf app 1.3.0 / iOS" without display changes.
 *
 * @returns the synthesized result, or null when the UA is not the app's
 * (callers fall back to ua-parser-js).
 */
export function parseCompanionUserAgent(
  userAgent: string | null | undefined
): IResult | null {
  const match = COMPANION_UA_REGEX.exec(userAgent ?? "");
  if (!match) {
    return null;
  }
  const [, appVersion, deviceToken, osToken] = match;

  // "iOS 18.6" -> name "iOS", version "18.6"
  const osSpace = osToken.indexOf(" ");
  const osName = osSpace === -1 ? osToken : osToken.slice(0, osSpace);
  const osVersion = osSpace === -1 ? undefined : osToken.slice(osSpace + 1);

  // iPhone/iPad carry no brand in the token; Android sends "<brand> <model>".
  let vendor: string;
  let model: string;
  if (deviceToken === "iPhone" || deviceToken === "iPad") {
    vendor = "Apple";
    model = deviceToken;
  } else {
    const deviceSpace = deviceToken.indexOf(" ");
    if (deviceSpace === -1) {
      // Bare "Android" fallback when the OS reports no brand/model.
      vendor = deviceToken.charAt(0).toUpperCase() + deviceToken.slice(1);
      model = "device";
    } else {
      const brand = deviceToken.slice(0, deviceSpace);
      vendor = brand.charAt(0).toUpperCase() + brand.slice(1);
      model = deviceToken.slice(deviceSpace + 1);
    }
  }

  return {
    ua: userAgent as string,
    browser: {
      name: `Shelf app ${appVersion}`,
      version: appVersion,
      major: undefined,
    },
    device: { vendor, model, type: "mobile" },
    os: { name: osName, version: osVersion },
    engine: { name: undefined, version: undefined },
    cpu: { architecture: undefined },
  };
}

function isValidUser(
  userOrganizations: UserOrganization[] | null | undefined,
  organizationId: string | null | undefined
) {
  if (!userOrganizations || !organizationId) {
    return false;
  }
  return userOrganizations.find((uo) => uo?.organizationId === organizationId);
}

export function parseScanData({
  scan,
  userId,
}: {
  scan:
    | (Scan & {
        user: (User & { userOrganizations: UserOrganization[] | null }) | null;
      } & { qr: Qr | null })
    | null;
  userId: string;
}) {
  try {
    /**
     * A few things we need to do to prepare the data for the client
     * 1. Coordinates - if they are null, we don't render the map, print unknown location
     * 2. User - Scanned by: You || Unknown
     */
    if (scan) {
      let scannedBy = scan.userId === userId ? "You" : "Unknown";
      const user = scan?.user;
      scannedBy =
        user && isValidUser(user?.userOrganizations, scan?.qr?.organizationId)
          ? `${resolveUserDisplayName(user)}(${user.email})`
          : "Unknown";
      const coordinates =
        scan.latitude && scan.longitude
          ? `${scan.latitude}, ${scan.longitude}`
          : "Unknown location";

      const ua =
        parseCompanionUserAgent(scan.userAgent) ?? parser(scan.userAgent || "");

      return {
        scannedBy,
        coordinates,
        dateTime: scan.createdAt,
        ua,
        manuallyGenerated: scan.manuallyGenerated,
      };
    }

    /** If there are no scans, return null */
    return null;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while parsing the scan data. Please try again.",
      additionalData: { userId, scan },
      label: "QR",
    });
  }
}
