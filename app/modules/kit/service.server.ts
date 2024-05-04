import type { Kit } from "@prisma/client";
import { db } from "~/database/db.server";
import { dateTimeInUnix } from "~/utils/date-time-in-unix";
import type { ErrorLabel } from "~/utils/error";
import { maybeUniqueConstraintViolation, ShelfError } from "~/utils/error";
import { oneDayFromNow } from "~/utils/one-week-from-now";
import { createSignedUrl, parseFileFormData } from "~/utils/storage.server";
import type { UpdateKitPayload } from "./types";

const label: ErrorLabel = "Kit";

export async function createKit({
  name,
  description,
  createdById,
  organizationId,
}: Pick<Kit, "name" | "description" | "createdById" | "organizationId">) {
  try {
    return await db.kit.create({
      data: {
        name,
        description,
        createdBy: { connect: { id: createdById } },
        organization: { connect: { id: organizationId } },
      },
    });
  } catch (cause) {
    throw maybeUniqueConstraintViolation(cause, "Kit", {
      additionalData: { userId: createdById, organizationId },
    });
  }
}

export async function updateKit({
  id,
  name,
  description,
  image,
  imageExpiration,
  status,
  createdById,
}: UpdateKitPayload) {
  try {
    return await db.kit.update({
      where: { id },
      data: {
        name,
        description,
        image,
        imageExpiration,
        status,
      },
    });
  } catch (cause) {
    throw maybeUniqueConstraintViolation(cause, "Kit", {
      additionalData: { userId: createdById, id },
    });
  }
}

export async function updateKitImage({
  request,
  kitId,
  userId,
}: {
  request: Request;
  kitId: string;
  userId: string;
}) {
  try {
    const fileData = await parseFileFormData({
      request,
      bucketName: "kits",
      newFileName: `${userId}/${kitId}/image-${dateTimeInUnix(Date.now())}`,
      resizeOptions: {
        width: 800,
        withoutEnlargement: true,
      },
    });

    const image = fileData.get("image") as string;
    if (!image) return;

    const signedUrl = await createSignedUrl({
      filename: image,
      bucketName: "kits",
    });

    await updateKit({
      id: kitId,
      image: signedUrl,
      imageExpiration: oneDayFromNow(),
      createdById: userId,
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while updating image for kit.",
      additionalData: { kitId, userId },
      label,
    });
  }
}
