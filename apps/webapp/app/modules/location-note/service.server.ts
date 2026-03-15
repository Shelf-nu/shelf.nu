import type { Location, LocationNote, User } from "@shelf/database";

import { db } from "~/database/db.server";
import {
  create,
  deleteMany,
  findFirst,
  findMany,
} from "~/database/query-helpers.server";
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
    return await create(db, "LocationNote", {
      content,
      type,
      locationId,
      ...(userId ? { userId } : {}),
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
  userId,
}: Pick<LocationNote, "content" | "locationId"> & { userId?: string }) {
  try {
    return await create(db, "LocationNote", {
      content,
      type: "UPDATE",
      locationId,
      ...(userId ? { userId } : {}),
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
    const location = await findFirst(db, "Location", {
      where: { id: locationId, organizationId },
      select: "id",
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

    return await findMany(db, "LocationNote", {
      where: { locationId },
      orderBy: { createdAt: "desc" },
      select: "*, user:User(firstName, lastName)",
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
    return await deleteMany(db, "LocationNote", { id, userId });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while deleting the location note.",
      additionalData: { id, userId },
      label,
    });
  }
}

export type LocationNoteWithUser = LocationNote & {
  user: { firstName: string | null; lastName: string | null } | null;
};
