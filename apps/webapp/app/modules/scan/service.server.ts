import type { Prisma, Scan } from "@prisma/client";
import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";
import type { ErrorLabel } from "~/utils/error";
import { wrapUserLinkForNote } from "~/utils/markdoc-wrappers";
import { createNote } from "../note/service.server";
import { getOrganizationById } from "../organization/service.server";
import { getQr } from "../qr/service.server";
import { getUserByID } from "../user/service.server";

const label: ErrorLabel = "Scan";

export async function createScan(params: {
  userAgent: string;
  userId?: Scan["userId"];
  qrId: string;
  deleted?: boolean;
  latitude?: Scan["latitude"];
  longitude?: Scan["longitude"];
  manuallyGenerated?: boolean;
}) {
  const {
    userAgent,
    userId,
    qrId,
    deleted = false,
    latitude = null,
    longitude = null,
    manuallyGenerated = false,
  } = params;

  try {
    const data = {
      userAgent,
      rawQrId: qrId,
      latitude,
      longitude,
      manuallyGenerated,
    };

    /** If user id is passed, connect to that user */
    if (userId && userId != "anonymous") {
      Object.assign(data, {
        user: {
          connect: {
            id: userId,
          },
        },
      });
    }

    /** If we link it to that QR and also store the id in the rawQrId field
     * If rawQrId is passed, we store the id of the deleted QR as a string
     *
     */

    if (!deleted) {
      Object.assign(data, {
        qr: {
          connect: {
            id: qrId,
          },
        },
      });
    }

    const scan = await db.scan.create({
      data,
    });

    await createScanNote({
      userId,
      qrId,
      longitude,
      latitude,
      manuallyGenerated,
    });

    return scan;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while creating a scan. Please try again or contact support.",
      additionalData: { params },
      label,
    });
  }
}

export async function updateScan(params: {
  id: Scan["id"];
  userId?: Scan["userId"];
  latitude?: Scan["latitude"];
  longitude?: Scan["longitude"];
  manuallyGenerated?: boolean;
}) {
  const { id, userId, latitude = null, longitude = null } = params;

  try {
    /** Delete the category id from the payload so we can use connect syntax from prisma */
    const data = {
      latitude,
      longitude,
    };

    if (userId) {
      Object.assign(data, {
        user: {
          connect: {
            id: userId,
          },
        },
      });
    }

    return await db.scan.update({
      where: { id },
      data,
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while updating the scan. Please try again or contact support.",
      additionalData: { params },
      label,
    });
  }
}

export async function getScanByQrId({ qrId }: { qrId: string }) {
  try {
    return await db.scan.findFirst({
      where: { rawQrId: qrId },
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          include: {
            userOrganizations: true,
          },
        },
        qr: true,
      },
      take: 1,
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while fetching the scan",
      additionalData: { qrId },
      label,
    });
  }
}

/**
 * Writes a system note onto the asset linked to a scanned QR code.
 *
 * The QR (and therefore the asset and `organizationId`) is resolved via
 * `getQr`. The resolved `organizationId` is forwarded to `createNote`, which
 * asserts the asset belongs to that org — preventing a crafted QR/asset ID
 * from attaching a note to another tenant's asset (cross-org IDOR).
 *
 * @param params.userId - Scanning user ID, or `"anonymous"`/null for anon scans
 * @param params.qrId - The QR code ID that was scanned
 * @param params.latitude - Optional GPS latitude captured with the scan
 * @param params.longitude - Optional GPS longitude captured with the scan
 * @param params.manuallyGenerated - Whether GPS was manually entered
 * @throws {ShelfError} If the QR/asset lookup or note write fails
 */
export async function createScanNote({
  userId,
  qrId,
  latitude,
  longitude,
  manuallyGenerated,
}: {
  userId?: string | null;
  qrId: string;
  latitude?: Scan["latitude"];
  longitude?: Scan["longitude"];
  manuallyGenerated?: boolean;
}) {
  try {
    let message = "";
    const { assetId, organizationId } = await getQr({ id: qrId });
    if (assetId && organizationId) {
      // Check if user has access to the asset's organization
      let hasAccess = false;

      let authenticatedUserId: string | null = null;

      if (userId && userId !== "anonymous") {
        authenticatedUserId = userId;

        // Check if user belongs to the asset's organization
        const userOrgCount = await db.userOrganization.count({
          where: {
            userId: authenticatedUserId,
            organizationId: organizationId,
          },
        });

        hasAccess = userOrgCount > 0;
      }

      if (hasAccess && authenticatedUserId) {
        // User has access - log their name
        const { firstName, lastName } = await getUserByID(authenticatedUserId, {
          select: {
            firstName: true,
            lastName: true,
            displayName: true,
          } satisfies Prisma.UserSelect,
        });
        const actor = wrapUserLinkForNote({
          id: authenticatedUserId,
          firstName,
          lastName,
        });
        if (manuallyGenerated) {
          message = `${actor} manually updated the GPS coordinates to *${latitude}, ${longitude}*.`;
        } else {
          message = `${actor} performed a scan of the asset QR code.`;
        }

        return await createNote({
          content: message,
          type: "UPDATE",
          userId: authenticatedUserId,
          assetId,
          // why: the QR (and therefore its asset) is scoped to this
          // organizationId — pass it so the note write is validated
          // against the asset's true org (cross-org IDOR guard)
          organizationId,
        });
      } else {
        // User doesn't have access or is anonymous - log as unknown user
        const { userId: ownerId } = await getOrganizationById(organizationId);
        message = "An unknown user has performed a scan of the asset QR code.";

        /* to create a note we are using user id to track which user created the note
        but in this case where scanner is anonymous, we are using the user id of the owner
        of the organization to which the scanner QR belongs */
        return await createNote({
          content: message,
          type: "UPDATE",
          userId: ownerId,
          assetId,
          // why: same QR-derived org as above; the anonymous-scan note
          // must still be validated against the asset's true org
          organizationId,
        });
      }
    }
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while creating a scan note",
      additionalData: { userId, qrId, latitude, longitude, manuallyGenerated },
      label,
    });
  }
}

/**
 * Max age of a scan whose geolocation may still be attached from the public,
 * unauthenticated /qr/:qrId endpoint. The legitimate browser flow posts
 * coordinates within seconds of the scan being created.
 */
const SCAN_GEO_UPDATE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Attaches geolocation to a freshly-created scan from the **public,
 * unauthenticated** `/qr/:qrId` route.
 *
 * SECURITY (CWE-639 / CWE-862): that route requires no authentication and
 * `scanId` is fully attacker-controlled. Calling `updateScan` directly there
 * let anyone overwrite the GPS of *any* scan record by id. We require BOTH:
 *
 *  1. the scan was created within {@link SCAN_GEO_UPDATE_WINDOW_MS} (matches
 *     the legitimate immediate client-side geolocation post; prevents
 *     tampering of arbitrary or historical scan records), AND
 *  2. the scan's `qrId` matches the QR id from the route's URL path — so a
 *     leaked `scanId` alone (URL share / Referer) cannot be used; an attacker
 *     would need the matching qrId for that specific scan as well.
 *
 * @param params.scanId - Scan id from public form input (untrusted)
 * @param params.qrId - QR id from the URL path (the trust-bound route param)
 * @param params.latitude - Geolocation latitude
 * @param params.longitude - Geolocation longitude
 * @returns The updated scan
 * @throws {ShelfError} 403 if the scan is missing, the qrId does not match,
 *                      the scan is older than the window, or its GPS was
 *                      already set (write-once)
 */
export async function updateScanGeolocation({
  scanId,
  qrId,
  latitude,
  longitude,
}: {
  scanId: Scan["id"];
  qrId: string;
  latitude?: Scan["latitude"];
  longitude?: Scan["longitude"];
}) {
  const scan = await db.scan.findUnique({
    where: { id: scanId },
    select: {
      id: true,
      createdAt: true,
      qrId: true,
      latitude: true,
      longitude: true,
    },
  });

  // why: GPS update is **symmetrically write-once** — reject if EITHER
  // coordinate is already populated, not only latitude. The route currently
  // requires both, but `updateScanGeolocation` accepts each as optional, so
  // an asymmetric latitude-only check would let a longitude-only write slip
  // through any future internal caller or schema relaxation. Combined with
  // the 5-min window and the qrId binding, this collapses the residual
  // attack surface (a leaked /qr/<id>?scanId=<id> URL) to a seconds-wide
  // race the legitimate client almost always wins, since the browser posts
  // coordinates immediately after page load. No schema change or capability-
  // token plumbing required for an anonymous scan-log field.
  if (
    !scan ||
    scan.qrId !== qrId ||
    scan.latitude !== null ||
    scan.longitude !== null ||
    Date.now() - scan.createdAt.getTime() > SCAN_GEO_UPDATE_WINDOW_MS
  ) {
    throw new ShelfError({
      cause: null,
      title: "Scan not found",
      message: "This scan can no longer be updated.",
      label,
      status: 403,
      shouldBeCaptured: false,
      additionalData: { scanId, qrId },
    });
  }

  return updateScan({ id: scanId, latitude, longitude });
}
