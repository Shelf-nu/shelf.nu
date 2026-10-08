import type {
  Location,
  LocationNote,
  Prisma,
  User,
  Organization,
} from "@prisma/client";

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
  userId,
}: Pick<LocationNote, "content" | "locationId"> & { userId?: string }) {
  try {
    return await db.locationNote.create({
      data: {
        content,
        type: "UPDATE",
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
        shouldBeCaptured: false,
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
            displayName: true,
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
  organizationId,
}: Pick<LocationNote, "id"> & {
  userId: User["id"];
  /**
   * Required, not optional: LocationNote has no organizationId column, so the only
   * scoping was `userId` -- which let an author delete a location note belonging to
   * an organization they are no longer part of. Making it required means the
   * compiler, not a grep, finds every call site.
   */
  organizationId: Organization["id"];
}) {
  try {
    // Scoped through the parent location, which is where organizationId lives.
    // Still one query -- a relation filter, not an extra round trip.
    const result = await db.locationNote.deleteMany({
      where: { id, userId, location: { organizationId } },
    });

    if (result.count === 0) {
      throw new ShelfError({
        cause: null,
        message: "Note not found or you don't have permission to delete it.",
        additionalData: { id, userId, organizationId },
        label,
        status: 403,
      });
    }

    return result;
  } catch (cause) {
    // The 403 above is deliberate and user-facing; re-wrapping it would hide
    // a refused cross-org delete behind a generic 500.
    if (cause instanceof ShelfError) {
      throw cause;
    }

    throw new ShelfError({
      cause,
      message: "Something went wrong while deleting the location note.",
      additionalData: { id, userId, organizationId },
      label,
    });
  }
}

export type LocationNoteWithUser = Prisma.LocationNoteGetPayload<{
  include: {
    user: { select: { firstName: true; lastName: true; displayName: true } };
  };
}>;
