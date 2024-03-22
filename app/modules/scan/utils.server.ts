import type { Scan } from ".prisma/client";
import parser from "ua-parser-js";
import { getDateTimeFormat } from "~/utils/client-hints";
import { ShelfError } from "~/utils/error";

export function parseScanData({
  scan,
  userId,
  request,
}: {
  scan: Scan | null;
  userId: string;
  request: Request;
}) {
  try {
    /**
     * A few things we need to do to prepare the data for the client
     * 1. Coordinates - if they are null, we don't render the map, print unknown location
     * 2. User - Scanned by: You || Unknown
     */
    if (scan) {
      const scannedBy = scan.userId === userId ? "You" : "Unknown";
      const coordinates =
        scan.latitude && scan.longitude
          ? `${scan.latitude}, ${scan.longitude}`
          : "Unknown location";

      const dateTime = getDateTimeFormat(request).format(scan.createdAt);
      const ua = parser(scan.userAgent || "");

      return {
        scannedBy,
        coordinates,
        dateTime,
        ua,
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
