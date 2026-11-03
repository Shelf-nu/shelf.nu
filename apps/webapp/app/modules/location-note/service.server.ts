import type {
  AssetType,
  Location,
  LocationNote,
  Prisma,
  User,
  Organization,
} from "@prisma/client";

import { db } from "~/database/db.server";
import { formatLocationLink, safeDisplay } from "~/modules/location/utils";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import {
  wrapAssetsWithDataForNote,
  wrapAssetWithCountForNote,
  wrapUserLinkForNote,
} from "~/utils/markdoc-wrappers";
import type { UserNameFields } from "~/utils/user";

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

/**
 * One asset leaving a location, arriving at one, or both. Mirrors a single
 * `ASSET_LOCATION_CHANGED` event: `from` is its `fromValue`, `to` its
 * `toValue`.
 */
export type AssetLocationMove = {
  asset: {
    id: string;
    title: string;
    type: AssetType;
    unitOfMeasure?: string | null;
  };
  /** The location the asset left, or `null` when it was unplaced. */
  from: Pick<Location, "id" | "name"> | null;
  /** The location the asset arrived at, or `null` when it is now unplaced. */
  to: Pick<Location, "id" | "name"> | null;
  /**
   * Units moved: the affected `AssetLocation.quantity`, NOT `Asset.quantity`.
   * Only named in the note for a QUANTITY_TRACKED asset moving alone.
   */
  quantity?: number | null;
  /**
   * Units that left `from`, when that differs from `quantity`: a replace that
   * drops a 10-unit placement and places 4 elsewhere took 10 away from the
   * source. Defaults to `quantity`.
   */
  fromQuantity?: number | null;
};

/**
 * Writes the location activity log lines for a set of asset moves: on each
 * destination "{user} added {assets} to {L}. Moved from {sources}." and on
 * each source "{user} removed {assets} from {L}. Moved to {destination}."
 *
 * Every flow that records `ASSET_LOCATION_CHANGED` calls this with the same
 * moves, so a location's Activity tab and its CSV export list every asset that
 * came or went, whichever surface (web, mobile API, kit cascade) moved it.
 * A move whose `from` and `to` are the same location is not a move and writes
 * nothing.
 *
 * Callers run this after their transaction commits, so it never throws: a
 * failed write is logged, and the move it describes stays saved.
 *
 * @param params.moves - The moves to describe, one per asset and location pair
 * @param params.actor - The user who made the moves, named on every line
 */
export async function createAssetLocationMoveNotes({
  moves,
  actor,
}: {
  moves: AssetLocationMove[];
  actor: UserNameFields & { id: User["id"] };
}) {
  const realMoves = moves.filter(
    (move) => (move.from || move.to) && move.from?.id !== move.to?.id
  );
  if (realMoves.length === 0) return;

  /** Arrivals grouped by destination; departures by source AND destination. */
  const arrivals = new Map<string, AssetLocationMove[]>();
  const departures = new Map<string, AssetLocationMove[]>();
  const addTo = (
    groups: Map<string, AssetLocationMove[]>,
    key: string,
    move: AssetLocationMove
  ) => {
    const group = groups.get(key);
    if (group) group.push(move);
    else groups.set(key, [move]);
  };
  for (const move of realMoves) {
    if (move.to) addTo(arrivals, move.to.id, move);
    if (move.from) {
      addTo(departures, `${move.from.id}:${move.to?.id ?? ""}`, move);
    }
  }

  const userLink = wrapUserLinkForNote(actor);
  const data: Prisma.LocationNoteCreateManyInput[] = [];

  for (const group of arrivals.values()) {
    const to = group[0].to!;
    const sources = new Map(
      group.flatMap((move) => (move.from ? [[move.from.id, move.from]] : []))
    );
    const movedFrom =
      sources.size > 0
        ? ` Moved from ${[...sources.values()]
            .map(formatLocationLink)
            .join(", ")}.`
        : "";
    data.push({
      locationId: to.id,
      type: "UPDATE",
      userId: actor.id,
      content: `${userLink} added ${assetMarkup(
        group,
        "added"
      )} to ${formatLocationLink(to)}.${movedFrom}`,
    });
  }

  for (const group of departures.values()) {
    const { from, to } = group[0];
    const movedTo = to ? ` Moved to ${formatLocationLink(to)}.` : "";
    data.push({
      locationId: from!.id,
      type: "UPDATE",
      userId: actor.id,
      content: `${userLink} removed ${assetMarkup(
        group.map((move) => ({
          ...move,
          quantity: move.fromQuantity ?? move.quantity,
        })),
        "removed"
      )} from ${formatLocationLink(from!)}.${movedTo}`,
    });
  }

  try {
    await db.locationNote.createMany({ data });
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause,
        message: "Something went wrong while recording the location activity.",
        additionalData: {
          assetIds: realMoves.map((move) => move.asset.id),
          userId: actor.id,
        },
        label,
      })
    );
  }
}

/**
 * One asset reads as its link, with the unit count for a QUANTITY_TRACKED
 * asset ("4 pcs of {asset}"); several read as one "N assets" popover. One
 * asset can appear more than once in a group (slices of a pool held by two
 * kits that move together), so a group of one asset adds its slices up.
 */
function assetMarkup(group: AssetLocationMove[], action: "added" | "removed") {
  const assets = new Map(group.map(({ asset }) => [asset.id, asset]));
  if (assets.size === 1) {
    const [asset] = assets.values();
    const quantity = group.every((move) => move.quantity != null)
      ? group.reduce((sum, move) => sum + (move.quantity ?? 0), 0)
      : null;
    return wrapAssetWithCountForNote(
      { ...asset, title: safeDisplay(asset.title) },
      quantity
    );
  }
  return wrapAssetsWithDataForNote(
    [...assets.values()].map((asset) => ({
      id: asset.id,
      title: safeDisplay(asset.title),
    })),
    action
  );
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
