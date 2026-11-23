/**
 * Booking sources repository.
 *
 * The only module that reads and writes `BookingAssetSource` and
 * `BookingDispositionShare`. Callers plan in memory with the pure helpers
 * (`@shelf/quantity-control`, `./conversion`, `./rehome`) and persist through
 * {@link writeSourcePlan}; they read a group's slices, rows, shares and
 * disposition logs through {@link loadGroupStates}.
 *
 * Every query is scoped by the caller's trusted `organizationId`: on the new
 * tables through their own `organizationId` column, on `BookingAsset` and
 * `ConsumptionLog` through `booking.organizationId`. An id from another
 * workspace is simply not found, and a write that names one is refused.
 *
 * Both functions run inside the caller's transaction and take no locks; the
 * caller holds the booking and asset locks. The deferred constraint triggers
 * re-check the final state at commit, so the order of writes inside one call
 * does not matter to them.
 *
 * @see {@link file://./types.ts} the shared pure types
 * @see {@link file://../../../../../../packages/quantity-control/src/booking-sources.ts} row rules
 */

import {
  KNOWN_KINDS,
  isRowRemovable,
  sourceKey,
  sourceRowViolations,
} from "@shelf/quantity-control";
import type { SourceKind, SourceRowState } from "@shelf/quantity-control";

import type { ExtendedPrismaClient } from "~/database/db.server";
import { ShelfError } from "~/utils/error";

import { BOOKING_DISPOSITION_CATEGORIES } from "../checkout-attribution";
import type {
  ConversionLog,
  ConversionSlice,
  GroupKey,
  PlannedShare,
  SourceAllocationMode,
} from "./types";

/**
 * The transaction client this repository needs: the Prisma client (or the
 * interactive transaction client `db.$transaction` hands its callback)
 * restricted to the models it touches.
 */
export type SourcesTx = Pick<
  ExtendedPrismaClient,
  | "bookingAsset"
  | "bookingAssetSource"
  | "bookingDispositionShare"
  | "consumptionLog"
  | "$queryRaw"
  | "$executeRaw"
>;

/** A persisted source row: its counters, its share sum and its identity. */
export type SourceRowRecord = SourceRowState & {
  id: string;
  bookingAssetId: string;
  organizationId: string;
};

/** Everything a planner needs about one group (one asset on one booking). */
export type GroupState = {
  /** The group's identity. */
  key: GroupKey;
  /** True when any slice is not LEGACY or any share exists for the group. */
  converted: boolean;
  /** Every slice of the group with its mode and its source rows. */
  slices: Array<
    ConversionSlice & { mode: SourceAllocationMode; rows: SourceRowRecord[] }
  >;
  /** The group's disposition logs (RETURN, CONSUME, LOSS, DAMAGE) only. */
  logs: ConversionLog[];
};

/** One source row as the caller wants it to end up. */
export type SourceRowWrite = {
  bookingAssetId: string;
  kind: SourceKind;
  locationId: string | null;
  quantity: number;
  outQuantity: number;
  releasedQuantity: number;
  dispatchedTotal: number;
};

/** Everything one call to {@link writeSourcePlan} persists. */
export type SourcePlanWrite = {
  /** Rows to create or overwrite, matched by slice and `sourceKey`. */
  upsertRows: SourceRowWrite[];
  /** Rows to delete. Each must end removable (all counters 0, no shares). */
  deleteRowIds: string[];
  /** Shares to insert; `sourceKey` is resolved to the row id after the upsert. */
  insertShares: PlannedShare[];
  /**
   * Moves every share on `fromRowId` to the row `toKey` of slice
   * `toBookingAssetId`, or orphans them when both are null.
   */
  repointShares: Array<{
    fromRowId: string;
    toBookingAssetId: string | null;
    toKey: string | null;
  }>;
  /** New modes; moving off LEGACY also stamps `sourcesConvertedAt`. */
  setModes: Array<{ bookingAssetId: string; mode: SourceAllocationMode }>;
};

/** Map key of a group: `${bookingId}:${assetId}`. */
export function groupMapKey(key: GroupKey): string {
  return `${key.bookingId}:${key.assetId}`;
}

/** Distinct group keys, in first-seen order. */
function distinctGroups(groups: GroupKey[]): GroupKey[] {
  const seen = new Map<string, GroupKey>();
  for (const g of groups) {
    const k = groupMapKey(g);
    if (!seen.has(k))
      seen.set(k, { bookingId: g.bookingId, assetId: g.assetId });
  }
  return [...seen.values()];
}

/**
 * Reads the state of several groups in one query per table.
 *
 * A group is converted when it has a non-LEGACY slice or any share row:
 * shares outlive their slices, so a group whose slices were all removed stays
 * converted through its orphaned shares. Every requested group is in the
 * result, also one with no slices left.
 *
 * `recordedSourceIsUnplaced` is always false: a slice records an explicit
 * Unplaced dispatch as a NULL `sourceLocationId`, which the schema cannot tell
 * apart from "no source recorded", so conversion decides that case from the
 * pool's placements.
 *
 * @param tx - The caller's transaction
 * @param args.organizationId - The trusted workspace id
 * @param args.groups - The groups to read
 * @returns The groups keyed by `${bookingId}:${assetId}`
 */
export async function loadGroupStates(
  tx: SourcesTx,
  args: { organizationId: string; groups: GroupKey[] }
): Promise<Map<string, GroupState>> {
  const { organizationId } = args;
  const groups = distinctGroups(args.groups);
  const result = new Map<string, GroupState>();
  if (groups.length === 0) return result;

  const groupWhere = groups.map((g) => ({
    bookingId: g.bookingId,
    assetId: g.assetId,
  }));

  const slices = await tx.bookingAsset.findMany({
    where: { OR: groupWhere, booking: { organizationId } },
    select: {
      id: true,
      bookingId: true,
      assetId: true,
      quantity: true,
      checkedOutQuantity: true,
      assetKitId: true,
      sourceLocationId: true,
      sourceAllocation: true,
    },
    orderBy: { id: "asc" },
  });
  const sliceIds = slices.map((s) => s.id);

  const [rows, shareSums, logs] = await Promise.all([
    sliceIds.length === 0
      ? Promise.resolve([])
      : tx.bookingAssetSource.findMany({
          where: { organizationId, bookingAssetId: { in: sliceIds } },
          select: {
            id: true,
            organizationId: true,
            bookingAssetId: true,
            kind: true,
            locationId: true,
            quantity: true,
            outQuantity: true,
            releasedQuantity: true,
            dispatchedTotal: true,
          },
          orderBy: { id: "asc" },
        }),
    // One grouped read answers both "does the group have shares" and the
    // share sum of every row.
    tx.bookingDispositionShare.groupBy({
      by: ["bookingId", "assetId", "bookingAssetSourceId"],
      where: { organizationId, OR: groupWhere },
      _sum: { quantity: true },
    }),
    tx.consumptionLog.findMany({
      where: {
        OR: groupWhere,
        booking: { organizationId },
        category: { in: [...BOOKING_DISPOSITION_CATEGORIES] },
      },
      select: {
        id: true,
        bookingId: true,
        assetId: true,
        bookingAssetId: true,
        quantity: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
  ]);

  const sharedByRow = new Map<string, number>();
  const groupsWithShares = new Set<string>();
  for (const s of shareSums) {
    groupsWithShares.add(
      groupMapKey({ bookingId: s.bookingId, assetId: s.assetId })
    );
    if (s.bookingAssetSourceId !== null) {
      sharedByRow.set(
        s.bookingAssetSourceId,
        (sharedByRow.get(s.bookingAssetSourceId) ?? 0) + (s._sum.quantity ?? 0)
      );
    }
  }

  const rowsBySlice = new Map<string, SourceRowRecord[]>();
  for (const r of rows) {
    const list = rowsBySlice.get(r.bookingAssetId) ?? [];
    list.push({ ...r, sharedQuantity: sharedByRow.get(r.id) ?? 0 });
    rowsBySlice.set(r.bookingAssetId, list);
  }

  for (const g of groups) {
    result.set(groupMapKey(g), {
      key: g,
      converted: groupsWithShares.has(groupMapKey(g)),
      slices: [],
      logs: [],
    });
  }
  for (const s of slices) {
    const state = result.get(
      groupMapKey({ bookingId: s.bookingId, assetId: s.assetId })
    );
    if (!state) continue;
    if (s.sourceAllocation !== "LEGACY") state.converted = true;
    state.slices.push({
      id: s.id,
      quantity: s.quantity,
      checkedOutQuantity: s.checkedOutQuantity,
      assetKitId: s.assetKitId,
      sourceLocationId: s.sourceLocationId,
      recordedSourceIsUnplaced: false,
      mode: s.sourceAllocation,
      rows: rowsBySlice.get(s.id) ?? [],
    });
  }
  for (const l of logs) {
    if (l.bookingId === null) continue;
    const state = result.get(
      groupMapKey({ bookingId: l.bookingId, assetId: l.assetId })
    );
    state?.logs.push({
      id: l.id,
      bookingAssetId: l.bookingAssetId,
      quantity: l.quantity,
      createdAt: l.createdAt,
    });
  }
  return result;
}

/** Refuses a plan the repository cannot write: a bug in the caller. */
function refusePlan(
  message: string,
  additionalData: Record<string, string | number | string[] | null>
): ShelfError {
  return new ShelfError({
    cause: null,
    title: "Booking sources",
    message,
    additionalData,
    label: "Booking",
    status: 500,
    shouldBeCaptured: true,
  });
}

/** A row being planned: its final counters, share sum and fate. */
type WorkingRow = SourceRowState & {
  /** The persisted id, or undefined for a row the plan creates. */
  id: string | undefined;
  bookingAssetId: string;
  /** True when `upsertRows` set its counters. */
  touched: boolean;
  /** True when the caller listed it in `deleteRowIds`. */
  explicitDelete: boolean;
};

/** Orders the rows a slice could keep: not asked to delete, known kinds, then key. */
function compareKeepCandidates(a: WorkingRow, b: WorkingRow): number {
  if (a.explicitDelete !== b.explicitDelete) return a.explicitDelete ? 1 : -1;
  const ka = KNOWN_KINDS.includes(a.kind) ? 0 : 1;
  const kb = KNOWN_KINDS.includes(b.kind) ? 0 : 1;
  if (ka !== kb) return ka - kb;
  const sa = sourceKey(a);
  const sb = sourceKey(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/**
 * Persists a source plan inside the caller's transaction.
 *
 * Steps: read the affected slices, their rows, the share sums of those rows
 * and the logs of new shares; apply the plan in memory; refuse it when a
 * resulting row breaks a row rule (`sourceRowViolations`), a share names a
 * row that will not exist, a listed delete is not removable, an id is outside
 * the workspace, or a mode goes back to LEGACY; then write. Rows that end
 * removable (all counters 0, no shares) are dropped, except that a KIT, AUTO
 * or MANUAL slice whose rows would all go keeps one (a row the caller did not
 * ask to delete, a known kind first), because such a slice needs at least one
 * row.
 *
 * Writes: row updates one per changed row, row creates in one `createMany`,
 * share moves one `updateMany` per moved row, new shares in one `createMany`,
 * deletes in one `deleteMany`, modes one `updateMany` per distinct change.
 *
 * Upserts are find-then-write, not `INSERT ... ON CONFLICT`: the rows of every
 * affected slice are read for validation anyway, the caller holds the asset
 * lock so no other writer adds the same key meanwhile, and the
 * `(bookingAssetId, kind, locationId)` unique index fails loudly if one does.
 *
 * @param tx - The caller's transaction
 * @param args.organizationId - The trusted workspace id
 * @param args.plan - What to persist
 * @throws {ShelfError} 500 when the plan is refused; nothing is written
 */
export async function writeSourcePlan(
  tx: SourcesTx,
  args: { organizationId: string; plan: SourcePlanWrite }
): Promise<void> {
  const { organizationId, plan } = args;
  if (
    plan.upsertRows.length === 0 &&
    plan.deleteRowIds.length === 0 &&
    plan.insertShares.length === 0 &&
    plan.repointShares.length === 0 &&
    plan.setModes.length === 0
  ) {
    return;
  }

  // 1. Rows named by id: their slices are affected too.
  const namedRowIds = [
    ...new Set([
      ...plan.deleteRowIds,
      ...plan.repointShares.map((r) => r.fromRowId),
    ]),
  ];
  const namedRows =
    namedRowIds.length === 0
      ? []
      : await tx.bookingAssetSource.findMany({
          where: { organizationId, id: { in: namedRowIds } },
          select: { id: true, bookingAssetId: true },
        });
  if (namedRows.length !== namedRowIds.length) {
    const found = new Set(namedRows.map((r) => r.id));
    throw refusePlan("A source row in the plan does not exist.", {
      missingRowIds: namedRowIds.filter((id) => !found.has(id)),
    });
  }

  // 2. Every affected slice, proven to be in the workspace.
  const sliceIds = [
    ...new Set([
      ...plan.upsertRows.map((r) => r.bookingAssetId),
      ...plan.insertShares.flatMap((s) =>
        s.bookingAssetId === null ? [] : [s.bookingAssetId]
      ),
      ...plan.repointShares.flatMap((r) =>
        r.toBookingAssetId === null ? [] : [r.toBookingAssetId]
      ),
      ...plan.setModes.map((m) => m.bookingAssetId),
      ...namedRows.map((r) => r.bookingAssetId),
    ]),
  ];
  const slices =
    sliceIds.length === 0
      ? []
      : await tx.bookingAsset.findMany({
          where: { id: { in: sliceIds }, booking: { organizationId } },
          select: {
            id: true,
            sourceAllocation: true,
            sourcesConvertedAt: true,
          },
        });
  if (slices.length !== sliceIds.length) {
    const found = new Set(slices.map((s) => s.id));
    throw refusePlan("A booking slice in the plan does not exist.", {
      missingSliceIds: sliceIds.filter((id) => !found.has(id)),
    });
  }
  const sliceById = new Map(slices.map((s) => [s.id, s]));

  // 3. Their rows and the share sum of each row.
  const existing =
    sliceIds.length === 0
      ? []
      : await tx.bookingAssetSource.findMany({
          where: { organizationId, bookingAssetId: { in: sliceIds } },
          select: {
            id: true,
            bookingAssetId: true,
            kind: true,
            locationId: true,
            quantity: true,
            outQuantity: true,
            releasedQuantity: true,
            dispatchedTotal: true,
          },
        });
  const existingIds = existing.map((r) => r.id);
  const shareSums =
    existingIds.length === 0
      ? []
      : await tx.bookingDispositionShare.groupBy({
          by: ["bookingAssetSourceId"],
          where: { organizationId, bookingAssetSourceId: { in: existingIds } },
          _sum: { quantity: true },
        });
  const sharedById = new Map<string, number>();
  for (const s of shareSums) {
    if (s.bookingAssetSourceId !== null) {
      sharedById.set(s.bookingAssetSourceId, s._sum.quantity ?? 0);
    }
  }

  // 4. The logs of new shares give each share its group.
  const logIds = [...new Set(plan.insertShares.map((s) => s.consumptionLogId))];
  const logs =
    logIds.length === 0
      ? []
      : await tx.consumptionLog.findMany({
          where: { id: { in: logIds }, booking: { organizationId } },
          select: { id: true, bookingId: true, assetId: true },
        });
  const logById = new Map(logs.map((l) => [l.id, l]));
  const missingLogs = logIds.filter((id) => !logById.get(id)?.bookingId);
  if (missingLogs.length > 0) {
    throw refusePlan("A disposition log in the plan does not exist.", {
      missingLogIds: missingLogs,
    });
  }

  // 5. Apply the plan in memory: slice id -> source key -> row.
  const model = new Map<string, Map<string, WorkingRow>>(
    sliceIds.map((id) => [id, new Map()])
  );
  const rowById = new Map<string, WorkingRow>();
  for (const r of existing) {
    const row: WorkingRow = {
      ...r,
      sharedQuantity: sharedById.get(r.id) ?? 0,
      touched: false,
      explicitDelete: false,
    };
    model.get(r.bookingAssetId)?.set(sourceKey(row), row);
    rowById.set(r.id, row);
  }
  const findRow = (sliceId: string, key: string) =>
    model.get(sliceId)?.get(key);

  for (const u of plan.upsertRows) {
    const key = sourceKey(u);
    const slice = model.get(u.bookingAssetId);
    const current = slice?.get(key);
    if (current?.touched) {
      throw refusePlan("The plan writes the same source row twice.", {
        bookingAssetId: u.bookingAssetId,
        sourceKey: key,
      });
    }
    const next: WorkingRow = {
      id: current?.id,
      bookingAssetId: u.bookingAssetId,
      kind: u.kind,
      locationId: u.locationId,
      quantity: u.quantity,
      outQuantity: u.outQuantity,
      releasedQuantity: u.releasedQuantity,
      dispatchedTotal: u.dispatchedTotal,
      sharedQuantity: current?.sharedQuantity ?? 0,
      touched: true,
      explicitDelete: false,
    };
    slice?.set(key, next);
    if (current?.id) rowById.set(current.id, next);
  }

  for (const r of plan.repointShares) {
    const from = rowById.get(r.fromRowId);
    if (!from) continue; // proven to exist in step 1
    // Take the units off the origin first, so a move onto itself keeps them.
    const moved = from.sharedQuantity;
    from.sharedQuantity = 0;
    if (r.toBookingAssetId === null) {
      if (r.toKey !== null) {
        throw refusePlan("An orphaned share cannot name a source row.", {
          fromRowId: r.fromRowId,
          toKey: r.toKey,
        });
      }
    } else {
      const to =
        r.toKey === null ? undefined : findRow(r.toBookingAssetId, r.toKey);
      if (!to) {
        throw refusePlan(
          "Shares are moved to a source row that does not exist.",
          {
            fromRowId: r.fromRowId,
            toBookingAssetId: r.toBookingAssetId,
            toKey: r.toKey,
          }
        );
      }
      to.sharedQuantity += moved;
    }
  }

  for (const s of plan.insertShares) {
    if (!Number.isInteger(s.quantity) || s.quantity <= 0) {
      throw refusePlan("A share quantity must be a positive integer.", {
        consumptionLogId: s.consumptionLogId,
        quantity: s.quantity,
      });
    }
    if (s.bookingAssetId === null) {
      if (s.sourceKey !== null) {
        throw refusePlan("An orphaned share cannot name a source row.", {
          consumptionLogId: s.consumptionLogId,
          sourceKey: s.sourceKey,
        });
      }
      continue;
    }
    const to =
      s.sourceKey === null ? undefined : findRow(s.bookingAssetId, s.sourceKey);
    if (!to) {
      throw refusePlan("A share names a source row that does not exist.", {
        consumptionLogId: s.consumptionLogId,
        bookingAssetId: s.bookingAssetId,
        sourceKey: s.sourceKey,
      });
    }
    to.sharedQuantity += s.quantity;
  }

  for (const id of plan.deleteRowIds) {
    const row = rowById.get(id);
    if (row) row.explicitDelete = true;
  }

  // Final modes; a converted slice never returns to LEGACY.
  const finalMode = new Map<string, SourceAllocationMode>(
    slices.map((s) => [s.id, s.sourceAllocation])
  );
  for (const m of plan.setModes) {
    const current = sliceById.get(m.bookingAssetId);
    if (
      current &&
      current.sourceAllocation !== "LEGACY" &&
      m.mode === "LEGACY"
    ) {
      throw refusePlan("A converted slice cannot return to LEGACY.", {
        bookingAssetId: m.bookingAssetId,
      });
    }
    finalMode.set(m.bookingAssetId, m.mode);
  }

  // 6. Decide which rows go, and validate the ones that stay.
  const toDelete: WorkingRow[] = [];
  const kept: WorkingRow[] = [];
  for (const [sliceId, rows] of model) {
    const all = [...rows.values()];
    for (const row of all) {
      if (row.explicitDelete && !isRowRemovable(row)) {
        throw refusePlan(
          "A source row with units or history cannot be deleted.",
          {
            rowId: row.id ?? null,
            bookingAssetId: sliceId,
            sourceKey: sourceKey(row),
          }
        );
      }
    }
    const removable = all.filter((r) => isRowRemovable(r));
    let keepOne: WorkingRow | undefined;
    if (
      finalMode.get(sliceId) !== "LEGACY" &&
      all.length > 0 &&
      removable.length === all.length
    ) {
      keepOne = [...removable].sort(compareKeepCandidates)[0];
    }
    for (const row of all) {
      if (isRowRemovable(row) && row !== keepOne) toDelete.push(row);
      else kept.push(row);
    }
  }
  for (const row of kept) {
    const violations = sourceRowViolations(row);
    if (violations.length > 0) {
      throw refusePlan("A source row breaks the booking source rules.", {
        rowId: row.id ?? null,
        bookingAssetId: row.bookingAssetId,
        sourceKey: sourceKey(row),
        violations,
      });
    }
  }

  // 7. Write rows.
  const toUpdate = kept.filter((r) => r.id !== undefined && r.touched);
  const toCreate = kept.filter((r) => r.id === undefined);
  for (const row of toUpdate) {
    await tx.bookingAssetSource.updateMany({
      where: { id: row.id, organizationId },
      data: {
        quantity: row.quantity,
        outQuantity: row.outQuantity,
        releasedQuantity: row.releasedQuantity,
        dispatchedTotal: row.dispatchedTotal,
      },
    });
  }
  if (toCreate.length > 0) {
    await tx.bookingAssetSource.createMany({
      data: toCreate.map((row) => ({
        organizationId,
        bookingAssetId: row.bookingAssetId,
        kind: row.kind,
        locationId: row.locationId,
        quantity: row.quantity,
        outQuantity: row.outQuantity,
        releasedQuantity: row.releasedQuantity,
        dispatchedTotal: row.dispatchedTotal,
      })),
    });
  }

  // 8. Resolve source keys to ids, re-reading once when rows were created.
  const idByKey = new Map<string, string>();
  const keyOf = (sliceId: string, key: string) => `${sliceId}|${key}`;
  const needsIds =
    plan.insertShares.some((s) => s.sourceKey !== null) ||
    plan.repointShares.some((r) => r.toKey !== null);
  if (needsIds && toCreate.length > 0) {
    const fresh = await tx.bookingAssetSource.findMany({
      where: { organizationId, bookingAssetId: { in: sliceIds } },
      select: { id: true, bookingAssetId: true, kind: true, locationId: true },
    });
    for (const r of fresh)
      idByKey.set(keyOf(r.bookingAssetId, sourceKey(r)), r.id);
  } else {
    for (const r of kept) {
      if (r.id) idByKey.set(keyOf(r.bookingAssetId, sourceKey(r)), r.id);
    }
  }
  const resolve = (sliceId: string, key: string): string => {
    const id = idByKey.get(keyOf(sliceId, key));
    if (!id) {
      throw refusePlan("A planned source row was not written.", {
        bookingAssetId: sliceId,
        sourceKey: key,
      });
    }
    return id;
  };

  // 9. Move and insert shares before deleting rows, so no delete orphans one.
  for (const r of plan.repointShares) {
    await tx.bookingDispositionShare.updateMany({
      where: { organizationId, bookingAssetSourceId: r.fromRowId },
      data: {
        bookingAssetId: r.toBookingAssetId,
        bookingAssetSourceId:
          r.toBookingAssetId === null || r.toKey === null
            ? null
            : resolve(r.toBookingAssetId, r.toKey),
      },
    });
  }
  if (plan.insertShares.length > 0) {
    await tx.bookingDispositionShare.createMany({
      data: plan.insertShares.map((s) => {
        const log = logById.get(s.consumptionLogId);
        return {
          organizationId,
          consumptionLogId: s.consumptionLogId,
          // Checked non-null in step 4.
          bookingId: log?.bookingId ?? "",
          assetId: log?.assetId ?? "",
          bookingAssetId: s.bookingAssetId,
          bookingAssetSourceId:
            s.bookingAssetId === null || s.sourceKey === null
              ? null
              : resolve(s.bookingAssetId, s.sourceKey),
          quantity: s.quantity,
          origin: s.origin,
        };
      }),
    });
  }

  const deleteIds = toDelete.flatMap((r) => (r.id ? [r.id] : []));
  if (deleteIds.length > 0) {
    await tx.bookingAssetSource.deleteMany({
      where: { organizationId, id: { in: deleteIds } },
    });
  }

  // 10. Modes, one update per distinct change.
  const now = new Date();
  const modeBatches = new Map<
    string,
    { mode: SourceAllocationMode; stamp: boolean; ids: string[] }
  >();
  for (const m of plan.setModes) {
    const current = sliceById.get(m.bookingAssetId);
    if (!current) continue;
    const stamp = m.mode !== "LEGACY" && current.sourcesConvertedAt === null;
    if (current.sourceAllocation === m.mode && !stamp) continue;
    const batchKey = `${m.mode}|${stamp}`;
    const batch = modeBatches.get(batchKey) ?? { mode: m.mode, stamp, ids: [] };
    batch.ids.push(m.bookingAssetId);
    modeBatches.set(batchKey, batch);
  }
  for (const batch of modeBatches.values()) {
    await tx.bookingAsset.updateMany({
      where: { id: { in: batch.ids }, booking: { organizationId } },
      data: batch.stamp
        ? { sourceAllocation: batch.mode, sourcesConvertedAt: now }
        : { sourceAllocation: batch.mode },
    });
  }
}
