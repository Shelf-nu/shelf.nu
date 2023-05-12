import type { Scan } from "@prisma/client";
import { db } from "~/database";

export async function createScan({
  userAgent,
  userId,
  qrId,
  deleted = false,
}: {
  userAgent: string;
  userId?: Scan["userId"];
  qrId: string;
  deleted?: boolean;
}) {
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

  return db.scan.create({
    data,
  });
}

export async function updateScan({
  id,
  userId,
  latitude = null,
  longitude = null,
}: {
  id: Scan["id"];
  userId?: Scan["userId"];
  latitude?: Scan["latitude"];
  longitude?: Scan["longitude"];
}) {
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

  return db.scan.update({
    where: { id },
    data,
  });
}

export async function getScanByQrId({ qrId }: { qrId: string }) {
  return db.scan.findFirst({
    where: { rawQrId: qrId },
    orderBy: { createdAt: "desc" },
    take: 1,
  });
}
