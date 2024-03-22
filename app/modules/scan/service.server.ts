import type { Scan } from "@prisma/client";
import { db } from "~/database/db.server";
import type { ErrorLabel } from "~/utils";
import { ShelfError } from "~/utils";

const label: ErrorLabel = "Scan";

export async function createScan(params: {
  userAgent: string;
  userId?: Scan["userId"];
  qrId: string;
  deleted?: boolean;
}) {
  const { userAgent, userId, qrId, deleted = false } = params;

  try {
    const data = {
      userAgent,
      rawQrId: qrId,
    };

    /** If user id is passed, connect to that user */
    if (userId) {
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

    return await db.scan.create({
      data,
    });
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
