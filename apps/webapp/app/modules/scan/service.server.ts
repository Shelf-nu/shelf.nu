import type { Scan } from "@shelf/database";
import { db } from "~/database/db.server";
import {
  count,
  create,
  findFirst,
  update,
} from "~/database/query-helpers.server";
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
    const data: Record<string, unknown> = {
      userAgent,
      rawQrId: qrId,
      latitude,
      longitude,
      manuallyGenerated,
    };

    /** If user id is passed, flatten the connect to direct FK */
    if (userId && userId != "anonymous") {
      data.userId = userId;
    }

    /** If we link it to that QR and also store the id in the rawQrId field
     * If rawQrId is passed, we store the id of the deleted QR as a string
     */
    if (!deleted) {
      data.qrId = qrId;
    }

    const scan = await create(db, "Scan", data as any);

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
    const data: Record<string, unknown> = {
      latitude,
      longitude,
    };

    if (userId) {
      data.userId = userId;
    }

    return await update(db, "Scan", {
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
    return await findFirst(db, "Scan", {
      where: { rawQrId: qrId },
      orderBy: { createdAt: "desc" },
      select:
        "*, user:User(*, userOrganizations:UserOrganization(*)), qr:Qr(*)",
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
        const userOrgCount = await count(db, "UserOrganization", {
          userId: authenticatedUserId,
          organizationId: organizationId,
        });

        hasAccess = userOrgCount > 0;
      }

      if (hasAccess && authenticatedUserId) {
        // User has access - log their name
        const { firstName, lastName } = await getUserByID(authenticatedUserId, {
          select: {
            firstName: true,
            lastName: true,
          },
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
