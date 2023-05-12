import type { Scan } from ".prisma/client";
var parser = require("ua-parser-js");

export const parseScanData = ({
  scan,
  userId,
}: {
  scan: Scan | null;
  userId: string;
}) => {
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
    const dateTime = new Date(scan.createdAt).toLocaleDateString();
    const ua = parser(scan.userAgent);

    return {
      scannedBy,
      coordinates,
      dateTime,
      ua,
    };
  }

  /** If there are no scans, return null */
  return null;
};
