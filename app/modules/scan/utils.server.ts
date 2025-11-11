import type { Qr, Scan, User, UserOrganization } from "@prisma/client";
import parser from "ua-parser-js";
import { ShelfError } from "~/utils/error";

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
    function isValidUser(
      userOrganizations: UserOrganization[] | null | undefined,
      organizationId: string | null | undefined
    ) {
      if (!userOrganizations || !organizationId) {
        return false;
      }
      return userOrganizations.find(
        (uo) => uo?.organizationId === organizationId
      );
    }
    if (scan) {
      let scannedBy = scan.userId === userId ? "You" : "Unknown";
      const user = scan?.user;
      scannedBy =
        user && isValidUser(user?.userOrganizations, scan?.qr?.organizationId)
          ? `${user.firstName} ${user.lastName}(${user.email})`
          : "Unknown";
      const coordinates =
        scan.latitude && scan.longitude
          ? `${scan.latitude}, ${scan.longitude}`
          : "Unknown location";

      const ua = parser(scan.userAgent || "");

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
