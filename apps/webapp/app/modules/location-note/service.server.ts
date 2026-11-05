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
 * One asset leaving a location, arriving at one, or both, as the location
 * activity log describes it. Usually the same change an
 * `ASSET_LOCATION_CHANGED` event records; where a flow rewrites several
 * placements at once, {@link placementChangeMoves} derives the moves from the
 * amounts, which can pair units the events record separately.
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
};

/** One location's amount of an asset, for {@link placementChangeMoves}. */
type PlacementAmount = {
  location: Pick<Location, "id" | "name">;
  quantity: number;
};

/**
 * Describes a rewrite of one asset's placements as moves, from each location's
 * amount before and after. Units a location lost and another gained moved
 * between them; units gained with no matching loss came from the unplaced
 * pool; units lost with no matching gain became unplaced. A location whose
 * amount is unchanged did not take part.
 *
 * Losses are paired with gains in the order of `before`, so pass the rows in a
 * stable order.
 *
 * @example
 * // 10 at Storage replaced by 4 at the Van: 4 moved, 6 became unplaced.
 * placementChangeMoves({
 *   asset,
 *   before: [{ location: storage, quantity: 10 }],
 *   after: [{ location: van, quantity: 4 }],
 * });
 * // => [{ from: storage, to: van, quantity: 4 },
 * //     { from: storage, to: null, quantity: 6 }]
 *
 * @param params.asset - The asset whose placements changed
 * @param params.before - Its placements before the rewrite
 * @param params.after - Its placements after the rewrite
 * @returns The moves to hand to {@link createAssetLocationMoveNotes}
 */
export function placementChangeMoves({
  asset,
  before,
  after,
}: {
  asset: AssetLocationMove["asset"];
  before: PlacementAmount[];
  after: PlacementAmount[];
}): AssetLocationMove[] {
  const amounts = new Map<
    string,
    { location: PlacementAmount["location"]; before: number; after: number }
  >();
  const amountAt = (location: PlacementAmount["location"]) => {
    const entry = amounts.get(location.id) ?? { location, before: 0, after: 0 };
    amounts.set(location.id, entry);
    return entry;
  };
  for (const row of before) amountAt(row.location).before += row.quantity;
  for (const row of after) amountAt(row.location).after += row.quantity;

  const losses = [...amounts.values()]
    .filter((entry) => entry.before > entry.after)
    .map((entry) => ({
      location: entry.location,
      left: entry.before - entry.after,
    }));
  const moves: AssetLocationMove[] = [];

  for (const entry of amounts.values()) {
    let gained = entry.after - entry.before;
    for (const loss of losses) {
      if (gained <= 0) break;
      const moved = Math.min(gained, loss.left);
      if (moved <= 0) continue;
      moves.push({
        asset,
        from: loss.location,
        to: entry.location,
        quantity: moved,
      });
      loss.left -= moved;
      gained -= moved;
    }
    if (gained > 0) {
      moves.push({ asset, from: null, to: entry.location, quantity: gained });
    }
  }
  for (const loss of losses) {
    if (loss.left > 0) {
      moves.push({ asset, from: loss.location, to: null, quantity: loss.left });
    }
  }
  return moves;
}

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

  /**
   * Arrivals grouped by destination and by whether they came from a location;
   * departures by source AND destination.
   */
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
    // Units from the unplaced pool get their own line, so "Moved from" names
    // the source of every unit on its line.
    if (move.to) {
      addTo(
        arrivals,
        `${move.to.id}:${move.from ? "placed" : "unplaced"}`,
        move
      );
    }
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
        group,
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
