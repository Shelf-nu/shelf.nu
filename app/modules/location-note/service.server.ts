import type { Location, LocationNote, Prisma, User } from "@prisma/client";

import { db } from "~/database/db.server";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError } from "~/utils/error";

const label: ErrorLabel = "Location";

type CreateLocationNoteArgs = Pick<LocationNote, "content" | "locationId"> & {
  type?: LocationNote["type"];
  userId?: User["id"] | null;
};

export async function createLocationNote({
  content,
  type = "COMMENT",
  locationId,
  userId,
}: CreateLocationNoteArgs) {
  try {
    return await db.locationNote.create({
      data: {
        content,
        type,
        location: {
          connect: { id: locationId },
        },
        ...(userId
          ? {
              user: {
                connect: { id: userId },
              },
            }
          : {}),
      },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while creating the location note.",
      additionalData: { locationId, userId },
      label,
    });
  }
}

export async function createSystemLocationNote({
  content,
  locationId,
}: Pick<LocationNote, "content" | "locationId">) {
  try {
    return await db.locationNote.create({
      data: {
        content,
        type: "UPDATE",
        location: {
          connect: { id: locationId },
        },
      },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while creating the location update.",
      additionalData: { locationId },
      label,
    });
  }
}

export async function getLocationNotes({
  locationId,
  organizationId,
}: Pick<LocationNote, "locationId"> & {
  organizationId: Location["organizationId"];
}) {
  try {
    const location = await db.location.findFirst({
      where: { id: locationId, organizationId },
      select: { id: true },
    });

    if (!location) {
      throw new ShelfError({
        cause: null,
        message: "Location not found or access denied",
        additionalData: { locationId, organizationId },
        label,
        status: 404,
      });
    }

    return await db.locationNote.findMany({
      where: { locationId },
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
    });
  } catch (cause) {
    if (cause instanceof ShelfError) {
      throw cause;
    }

    throw new ShelfError({
      cause,
      message: "Something went wrong while fetching the location notes.",
      additionalData: { locationId, organizationId },
      label,
    });
  }
}

export async function deleteLocationNote({
  id,
  userId,
}: Pick<LocationNote, "id"> & { userId: User["id"] }) {
  try {
    return await db.locationNote.deleteMany({
      where: { id, userId },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while deleting the location note.",
      additionalData: { id, userId },
      label,
    });
  }
}

export type LocationNoteWithUser = Prisma.LocationNoteGetPayload<{
  include: { user: { select: { firstName: true; lastName: true } } };
}>;
