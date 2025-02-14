import type { Scan } from "@prisma/client";
import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";
import type { ErrorLabel } from "~/utils/error";
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
    let data = {
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
    if (assetId) {
      if (userId && userId != "anonymous") {
        const { firstName, lastName } = await getUserByID(userId);
        const userName =
          (firstName ? firstName.trim() : "") +
          " " +
          (lastName ? lastName.trim() : "");
        if (manuallyGenerated) {
          message = `**${userName}** manually updated the GPS coordinates to *${latitude}, ${longitude}*.`;
        } else {
          message = `**${userName}** performed a scan of the asset QR code.`;
        }
        return await createNote({
          content: message,
          type: "UPDATE",
          userId,
          assetId,
        });
      } else {
        if (organizationId) {
          // If there is an assetId there will always be organization id. This is an extra check for organizationId.

          const { userId: ownerId } = await getOrganizationById(organizationId);
          message = "An unknown user has performed a scan of the asset QR code";

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
