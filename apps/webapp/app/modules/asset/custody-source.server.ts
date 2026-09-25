/**
 * Database side of custody source locations.
 *
 * Reads a pool's manual placements and operator custody under the caller's
 * asset lock, answers "how many units does this location have left", and
 * applies the re-home plan when a placement change leaves a location holding
 * fewer units than are in custody from it. The rules themselves are pure and
 * live in `custody-source.ts`.
 *
 * @see {@link file://./custody-source.ts}
 */

import type { AssetType, Prisma } from "@prisma/client";
import type { ITXClientDenyList } from "@prisma/client/runtime/library";
import type { ExtendedPrismaClient } from "~/database/db.server";
import { db } from "~/database/db.server";
import { computeCustodyAvailability } from "~/modules/asset/availability-primitives.server";
import { createSystemLocationNote } from "~/modules/location-note/service.server";
import { createNote } from "~/modules/note/service.server";
import { formatUnitCount } from "~/utils/asset-quantity";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import {
  wrapAssetWithCountForNote,
  wrapLinkForNote,
  wrapUserLinkForNote,
} from "~/utils/markdoc-wrappers";
import type {
  CustodyRowForPlan,
  CustodySourceState,
  CustodySourceSummary,
  RehomeMove,
} from "./custody-source";
import {
  buildCustodySourceOptions,
  hasMultipleSources,
  planCustodyRehome,
  unitsLeftAtSource,
} from "./custody-source";

/**
 * Transaction client these helpers read and write through. The extended
 * client's `$transaction` callback param is not assignable to the generated
 * `Prisma.TransactionClient`, so the tx-denied members are omitted instead,
 * the same approach as the kit placement helpers.
 */
export type CustodySourceTxClient = Omit<
  ExtendedPrismaClient,
  ITXClientDenyList
>;

/** A pool's source state plus its operator custody rows with ids. */
export type LoadedCustodySources = {
  state: CustodySourceState;
  rows: CustodyRowForPlan[];
};

/**
 * Reads a pool's manual placements and operator custody.
 *
 * Call it inside the transaction that holds `lockAssetForQuantityUpdate` for
 * the asset, so the numbers cannot move before the caller writes.
 *
 * @param tx - Transaction client holding the asset lock
 * @param assetId - The pool
 * @param total - `Asset.quantity` from the locked row
 */
export async function loadCustodySources(
  tx: CustodySourceTxClient,
  { assetId, total }: { assetId: string; total: number }
): Promise<LoadedCustodySources> {
  const [placements, rows] = await Promise.all([
    tx.assetLocation.findMany({
      where: { assetId, assetKitId: null },
      select: { locationId: true, quantity: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    tx.custody.findMany({
      where: { assetId, kitCustodyId: null },
      select: {
        id: true,
        teamMemberId: true,
        locationId: true,
        quantity: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
  ]);

  return {
    state: { total, placements, operatorCustody: rows },
    rows,
  };
}

/**
 * {@link loadCustodySources} for many pools in two queries, for paths that
 * change placements of many assets at once. Only pools with operator
 * custody are returned: a placement change can only re-home custody that
 * exists.
 *
 * @param assets - Pools (already locked by the caller) with their totals
 */
export async function loadCustodySourcesForAssets(
  tx: CustodySourceTxClient,
  assets: Array<{ id: string; total: number }>
): Promise<Map<string, LoadedCustodySources>> {
  const result = new Map<string, LoadedCustodySources>();
  if (assets.length === 0) return result;

  const rows = await tx.custody.findMany({
    where: { assetId: { in: assets.map((a) => a.id) }, kitCustodyId: null },
    select: {
      id: true,
      assetId: true,
      teamMemberId: true,
      locationId: true,
      quantity: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (rows.length === 0) return result;

  const heldIds = Array.from(new Set(rows.map((row) => row.assetId)));
  const placements = await tx.assetLocation.findMany({
    where: { assetId: { in: heldIds }, assetKitId: null },
    select: { assetId: true, locationId: true, quantity: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  for (const asset of assets) {
    if (!heldIds.includes(asset.id)) continue;
    const assetRows = rows.filter((row) => row.assetId === asset.id);
    result.set(asset.id, {
      state: {
        total: asset.total,
        placements: placements.filter((p) => p.assetId === asset.id),
        operatorCustody: assetRows,
      },
      rows: assetRows,
    });
  }
  return result;
}

/**
 * {@link rehomeCustodyForPlacementChange} for many pools at once: reads the
 * after-state in two queries, then plans and applies each pool's moves.
 *
 * @param before - {@link loadCustodySourcesForAssets} taken before the writes
 * @param totals - `Asset.quantity` per pool after the change
 * @param destinationFor - The single location a pool's change sent units to
 * @returns The pools whose custody moved, with what moved
 */
export async function rehomeCustodyForPlacementChanges(
  tx: CustodySourceTxClient,
  {
    before,
    totals,
    destinationFor,
  }: {
    before: Map<string, LoadedCustodySources>;
    totals: Map<string, number>;
    destinationFor: (assetId: string) => string | null | undefined;
  }
): Promise<Array<{ assetId: string; result: CustodyRehomeResult }>> {
  const assetIds = Array.from(before.keys());
  if (assetIds.length === 0) return [];

  const after = await loadCustodySourcesForAssets(
    tx,
    assetIds.map((id) => ({ id, total: totals.get(id) ?? 0 }))
  );

  const results: Array<{ assetId: string; result: CustodyRehomeResult }> = [];
  for (const assetId of assetIds) {
    const beforeState = before.get(assetId);
    const afterState = after.get(assetId);
    if (!beforeState || !afterState) continue;

    const moves = planCustodyRehome({
      before: beforeState.state,
      after: afterState.state,
      rows: afterState.rows,
      destinationLocationId: destinationFor(assetId),
    });
    if (moves.length === 0) continue;

    await applyCustodyRehome(tx, { assetId, moves });
    results.push({
      assetId,
      result: {
        moves,
        multiSource:
          hasMultipleSources(beforeState.state) ||
          hasMultipleSources(afterState.state),
      },
    });
  }
  return results;
}

/**
 * Units a source has left to hand out: placed there minus already in custody
 * from there (NULL: unplaced minus custody recorded against the unplaced
 * units). The DB-backed form of `unitsLeftAtSource`, and the only way server
 * code should ask the question.
 */
export async function unitsLeftAtLocation(
  tx: CustodySourceTxClient,
  {
    assetId,
    locationId,
    total,
  }: { assetId: string; locationId: string | null; total: number }
): Promise<number> {
  const { state } = await loadCustodySources(tx, { assetId, total });
  return unitsLeftAtSource(state, locationId);
}

/**
 * Applies re-home moves to the custody rows, merging into an existing row
 * for the same (holder, target) when there is one: the operator unique index
 * allows one row per holder per source.
 *
 * A whole row moving to a target with no existing row is re-pointed in place
 * so it keeps its id and `createdAt`.
 */
export async function applyCustodyRehome(
  tx: CustodySourceTxClient,
  { assetId, moves }: { assetId: string; moves: RehomeMove[] }
): Promise<void> {
  if (moves.length === 0) return;

  const rowIds = Array.from(new Set(moves.map((m) => m.rowId)));
  const current = await tx.custody.findMany({
    where: { id: { in: rowIds }, assetId, kitCustodyId: null },
    select: { id: true, quantity: true },
  });
  const quantityById = new Map(current.map((r) => [r.id, r.quantity]));

  for (const move of moves) {
    const rowQuantity = quantityById.get(move.rowId);
    if (rowQuantity == null || rowQuantity < move.quantity) {
      throw new ShelfError({
        cause: null,
        message: "Could not update the custody locations. Please try again.",
        additionalData: { assetId, move, rowQuantity },
        label: "Assets",
      });
    }

    const target = await tx.custody.findFirst({
      where: {
        assetId,
        teamMemberId: move.teamMemberId,
        locationId: move.toLocationId,
        kitCustodyId: null,
      },
      select: { id: true },
    });

    const wholeRow = rowQuantity === move.quantity;

    if (wholeRow && !target) {
      // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: `move.rowId` comes from the operator custody rows this module read for `assetId`, inside the caller's locked transaction
      await tx.custody.update({
        where: { id: move.rowId },
        data: { locationId: move.toLocationId },
      });
      quantityById.delete(move.rowId);
      continue;
    }

    if (wholeRow) {
      // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: same provenance as the update above
      await tx.custody.delete({ where: { id: move.rowId } });
      quantityById.delete(move.rowId);
    } else {
      // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: same provenance as the update above
      await tx.custody.update({
        where: { id: move.rowId },
        data: { quantity: { decrement: move.quantity } },
      });
      quantityById.set(move.rowId, rowQuantity - move.quantity);
    }

    if (target) {
      // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: `target.id` came from the asset-scoped findFirst above
      await tx.custody.update({
        where: { id: target.id },
        data: { quantity: { increment: move.quantity } },
      });
      quantityById.set(
        target.id,
        (quantityById.get(target.id) ?? 0) + move.quantity
      );
    } else {
      const created = await tx.custody.create({
        data: {
          assetId,
          teamMemberId: move.teamMemberId,
          locationId: move.toLocationId,
          quantity: move.quantity,
        },
        select: { id: true },
      });
      quantityById.set(created.id, move.quantity);
    }
  }
}

/** What a placement change did to the custody sources. */
export type CustodyRehomeResult = {
  moves: RehomeMove[];
  /** Whether the pool was placed at two or more locations before or after the change. */
  multiSource: boolean;
};

/**
 * Makes custody follow a placement change that lowered, removed or collapsed
 * a manual placement, without refusing it. See `planCustodyRehome` for the
 * rules. Call it after the placement write, inside the same locked
 * transaction, with the state read before the write.
 *
 * @param before - {@link loadCustodySources} output taken before the write
 * @param destinationLocationId - The single location the change sent units
 *   to (a move, or a whole-pool relocation). Omit when there is none.
 */
export async function rehomeCustodyForPlacementChange(
  tx: CustodySourceTxClient,
  {
    assetId,
    total,
    before,
    destinationLocationId,
  }: {
    assetId: string;
    /** `Asset.quantity` after the change. */
    total: number;
    before: LoadedCustodySources;
    destinationLocationId?: string | null;
  }
): Promise<CustodyRehomeResult> {
  const after = await loadCustodySources(tx, { assetId, total });

  // Nothing out on the operator axis: nothing can need a new home.
  if (after.rows.length === 0) {
    return { moves: [], multiSource: false };
  }

  const moves = planCustodyRehome({
    before: before.state,
    after: after.state,
    rows: after.rows,
    destinationLocationId,
  });

  await applyCustodyRehome(tx, { assetId, moves });

  return {
    moves,
    multiSource:
      hasMultipleSources(before.state) || hasMultipleSources(after.state),
  };
}

/**
 * Writes the asset note that says where custody now belongs after a
 * placement change, e.g. "2 pcs in custody now belong at Studio." or
 * "1 pcs in custody are now unplaced.". Names of holders are kept out: the
 * phone shows recent notes to every role.
 *
 * Only written for pools placed at two or more locations, so a pool at one location
 * that moves wholesale changes nothing on screen. Best-effort: the placement
 * change has committed, so a failure is logged and swallowed.
 */
export async function createCustodyRehomeNote({
  result,
  asset,
  userId,
  organizationId,
}: {
  result: CustodyRehomeResult;
  asset: {
    id: string;
    type: AssetType;
    unitOfMeasure: string | null;
  };
  userId: string;
  organizationId: string;
}): Promise<void> {
  if (!result.multiSource || result.moves.length === 0) return;

  try {
    const byTarget = new Map<string | null, number>();
    for (const move of result.moves) {
      byTarget.set(
        move.toLocationId,
        (byTarget.get(move.toLocationId) ?? 0) + move.quantity
      );
    }

    const locationIds = Array.from(byTarget.keys()).filter(
      (id): id is string => id !== null
    );
    const [locations, user] = await Promise.all([
      locationIds.length
        ? db.location.findMany({
            where: { id: { in: locationIds }, organizationId },
            select: { id: true, name: true },
          })
        : Promise.resolve([] as Array<{ id: string; name: string }>),
      db.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          displayName: true,
        } satisfies Prisma.UserSelect,
      }),
    ]);
    const nameById = new Map(locations.map((l) => [l.id, l.name]));

    const sentences = Array.from(byTarget.entries()).map(([toId, quantity]) => {
      const count = formatUnitCount(asset, quantity) ?? `${quantity} units`;
      if (toId === null) {
        return `**${count}** in custody are now unplaced.`;
      }
      const name = nameById.get(toId) ?? "another location";
      return `**${count}** in custody now belong at ${wrapLinkForNote(
        `/locations/${toId}`,
        name
      )}.`;
    });

    const lead = user
      ? `${wrapUserLinkForNote(user)} changed where this asset is placed.`
      : "The placements of this asset changed.";

    await createNote({
      content: [lead, ...sentences].join(" "),
      type: "UPDATE",
      userId,
      assetId: asset.id,
      organizationId,
    });
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause,
        message: "Failed to write the custody re-home note",
        additionalData: { assetId: asset.id, organizationId },
        label: "Assets",
      })
    );
  }
}

/** Location names the dropdowns need, with the parent for disambiguation. */
type SourceLocationRow = {
  id: string;
  name: string;
  parent: { name: string } | null;
};

/**
 * Builds the source summary the asset page loader ships to both entry points
 * of the Assign dialog (custody card and header actions) and to the Adjust
 * dialog, so they all show the same numbers.
 *
 * @param assetId - A pool already org-verified by the caller's loader
 * @param total - `Asset.quantity`
 */
export async function getCustodySourceSummary({
  assetId,
  organizationId,
  total,
}: {
  assetId: string;
  organizationId: string;
  total: number;
}): Promise<CustodySourceSummary> {
  const [{ state }, { available }] = await Promise.all([
    loadCustodySources(db, { assetId, total }),
    computeCustodyAvailability(db, {
      assetId,
      organizationId,
      totalQuantity: total,
    }),
  ]);

  if (!hasMultipleSources(state)) {
    return { multiSource: false, options: [], poolAvailable: available };
  }

  const locations: SourceLocationRow[] = await db.location.findMany({
    where: {
      id: { in: state.placements.map((p) => p.locationId) },
      organizationId,
    },
    select: { id: true, name: true, parent: { select: { name: true } } },
  });

  return {
    multiSource: true,
    poolAvailable: available,
    options: buildCustodySourceOptions(
      state,
      locations.map((l) => ({
        id: l.id,
        name: l.name,
        parentName: l.parent?.name ?? null,
      }))
    ),
  };
}

/** What happened to units at a location, for its timeline note. */
export type CustodySourceNoteVerb =
  | "assigned"
  | "consumed"
  | "restocked"
  | "lost"
  | "added"
  | "removed";

/**
 * Writes a note on a location's timeline when units of a pool leave it into
 * custody, are used up from it, or are restocked / lost there. Holders are
 * never named: the note says what happened to the location's units.
 *
 * Only called for pools placed at two or more locations, so a pool at one location
 * adds nothing new to its location's timeline. Best-effort: the stock
 * change has committed, so a failure is logged and swallowed.
 */
export async function createCustodySourceLocationNote({
  userId,
  asset,
  locationId,
  locationName,
  quantity,
  verb,
}: {
  userId: string;
  asset: {
    id: string;
    title: string;
    type: AssetType;
    unitOfMeasure: string | null;
  };
  locationId: string;
  locationName: string | null;
  quantity: number;
  verb: CustodySourceNoteVerb;
}): Promise<void> {
  try {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        displayName: true,
      } satisfies Prisma.UserSelect,
    });
    const actor = user ? wrapUserLinkForNote(user) : "Someone";
    const units = wrapAssetWithCountForNote(asset, quantity);
    const location = wrapLinkForNote(
      `/locations/${locationId}`,
      locationName ?? "this location"
    );

    const content = {
      assigned: `${actor} assigned ${units} from ${location} to custody.`,
      consumed: `${actor} marked ${units} from ${location} as used up.`,
      restocked: `${actor} restocked ${units} at ${location}.`,
      lost: `${actor} recorded ${units} as lost at ${location}.`,
      added: `${actor} added ${units} at ${location} (adjustment).`,
      removed: `${actor} removed ${units} from ${location} (adjustment).`,
    }[verb];

    await createSystemLocationNote({ locationId, content, userId });
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause,
        message: "Failed to write the location note for a custody source",
        additionalData: { assetId: asset.id, locationId, verb },
        label: "Assets",
      })
    );
  }
}

/**
 * The " from <Location>" part of an Assign audit note. Empty for pools with
 * fewer than two sources, so their notes read exactly as they always have,
 * and empty when an older client named no source (nothing is known).
 */
export function assignSourceNoteSuffix(source: {
  locationId: string | null;
  locationName: string | null;
  explicit: boolean;
  multiSource: boolean;
}): string {
  if (!source.multiSource) return "";
  if (source.locationId) {
    return ` from ${wrapLinkForNote(
      `/locations/${source.locationId}`,
      source.locationName ?? "a location"
    )}`;
  }
  return source.explicit ? " from the unplaced units" : "";
}

/**
 * The " (2 from Camera Room, 1 unplaced)" part of a Release / Mark as
 * consumed audit note. Empty for pools with fewer than two sources.
 */
export function releaseSourceNoteSuffix({
  lines,
  multiSource,
}: {
  lines: Array<{
    locationId: string | null;
    locationName: string | null;
    quantity: number;
  }>;
  multiSource: boolean;
}): string {
  if (!multiSource || lines.length === 0) return "";
  const parts = lines.map((line) =>
    line.locationId
      ? `${line.quantity} from ${wrapLinkForNote(
          `/locations/${line.locationId}`,
          line.locationName ?? "a location"
        )}`
      : `${line.quantity} unplaced`
  );
  return ` (${parts.join(", ")})`;
}

/**
 * The " at <Location>" part of an Adjust audit note. Empty for pools with
 * fewer than two sources, and when no location was named.
 */
export function adjustLocationNoteSuffix(
  location: {
    locationId: string | null;
    locationName: string | null;
    multiSource: boolean;
  },
  locationWasNamed: boolean
): string {
  if (!location.multiSource || !locationWasNamed) return "";
  if (location.locationId) {
    return ` at ${wrapLinkForNote(
      `/locations/${location.locationId}`,
      location.locationName ?? "a location"
    )}`;
  }
  return " (unplaced units)";
}

/**
 * Units in operator custody taken from one location, per quantity-tracked
 * asset, for the location page's "· N in custody". Only pools placed at two
 * or more locations appear in the result, so a pool at one location reads
 * there exactly as it always has.
 *
 * @param locationId - The location the page is about (already org-verified)
 * @param pools - The page's quantity-tracked assets with their totals
 * @returns `assetId -> units in custody from this location`, zero omitted
 */
export async function getCustodyFromLocationByPool({
  locationId,
  organizationId,
  pools,
}: {
  locationId: string;
  organizationId: string;
  pools: Array<{ id: string; total: number }>;
}): Promise<Record<string, number>> {
  if (pools.length === 0) return {};
  const poolIds = pools.map((pool) => pool.id);

  const [placements, custody] = await Promise.all([
    db.assetLocation.findMany({
      where: { assetId: { in: poolIds }, assetKitId: null, organizationId },
      select: { assetId: true, locationId: true, quantity: true },
    }),
    db.custody.groupBy({
      by: ["assetId"],
      where: {
        assetId: { in: poolIds },
        locationId,
        kitCustodyId: null,
        asset: { organizationId },
      },
      _sum: { quantity: true },
    }),
  ]);

  const result: Record<string, number> = {};
  for (const pool of pools) {
    const inCustody =
      custody.find((row) => row.assetId === pool.id)?._sum.quantity ?? 0;
    if (inCustody <= 0) continue;
    const state: CustodySourceState = {
      total: pool.total,
      placements: placements.filter((p) => p.assetId === pool.id),
      operatorCustody: [],
    };
    if (hasMultipleSources(state)) result[pool.id] = inCustody;
  }
  return result;
}
