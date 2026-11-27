/**
 * Booking sources for kit paths: kit quantity changes and kit detachment.
 *
 * A kit-driven slice of a converted group carries exactly one KIT source row
 * (its pending, out, released and history, tied to no loose source). The kit
 * service changes those slices from outside any booking action, so it keeps
 * their rows right through this module:
 *
 * - {@link resizeKitSourceRows}: a kit quantity change propagated to its kit
 *   slices resizes each converted KIT row (an increase is new pending units; a
 *   decrease takes pending first, then released, and never goes below the
 *   units out).
 * - {@link detachKitSliceSources}: a kit slice losing its kit (membership
 *   removed, kit deleted, units moved out of a kit) is split into the parts its
 *   KIT row holds. Without a standalone sibling the slice becomes AUTO: out
 *   units and history go to an UNKNOWN row (they left as kit units), released
 *   units to UNASSIGNED, pending units are allocated from loose sources with
 *   the rest on UNASSIGNED (never refused: the detach is not the booking's
 *   choice). With a standalone sibling the same parts merge into that sibling,
 *   and the caller folds the slice's quantity and `checkedOutQuantity` into it.
 * - {@link lockKitDetachPools}: the one asset lock a kit detach path takes
 *   before it deletes or detaches kit slices.
 * - {@link seedKitRowsForNewKitSlices}: kit slices a membership change adds to
 *   bookings join a converted group as KIT slices with one KIT row each.
 *
 * Kit paths take asset locks only (one sorted statement covering every asset
 * the path touches), never booking locks:
 * every booking writer locks its booking and then the same assets, so the two
 * serialize on the asset rows without a lock-order inversion. Every decision is
 * made from rows read after the lock.
 *
 * Fast path: with adoption off and every slice LEGACY, a detach path costs
 * the one probe statement of {@link lockKitDetachPools}; the resize and the
 * detach themselves send no query.
 *
 * @see {@link file://./kit-quantity.ts} the KIT row resize rule
 * @see {@link file://./conversion.server.ts} the group session
 * @see {@link file://../../kit/service.server.ts} the kit paths that call in
 */

import { BookingStatus, Prisma } from "@prisma/client";
import { pendingOf, sourceKey } from "@shelf/quantity-control";
import type { SourceRowState } from "@shelf/quantity-control";

import { BOOKING_SOURCES_ENABLED } from "~/utils/env";
import { ShelfError } from "~/utils/error";

import {
  addToRow,
  allocateSessionPending,
  allocateToSlice,
  buildSessionPlan,
  lockGroupAssets,
  manualSourceKeys,
  openGroupSession,
} from "./conversion.server";
import type {
  BookingSourcesTx,
  GroupSession,
  WorkingGroup,
  WorkingRow,
  WorkingSlice,
} from "./conversion.server";
import { resizeKitRow } from "./kit-quantity";
import { groupMapKey, writeSourcePlan } from "./repository.server";
import type { SourcePlanWrite, SourceRowWrite } from "./repository.server";
import { settlementWindow } from "./settlement";
import type { SourceAllocationMode } from "./types";

/**
 * Booking statuses whose kit slices follow the kit: kit quantity propagation
 * and its guards touch these only. COMPLETE, CANCELLED and ARCHIVED slices are
 * frozen records and keep their quantity and their KIT row unchanged.
 */
export const KIT_PROPAGATION_STATUSES: BookingStatus[] = [
  BookingStatus.DRAFT,
  BookingStatus.RESERVED,
  BookingStatus.ONGOING,
  BookingStatus.OVERDUE,
];

/** Modes of a converted slice; anything else (LEGACY, unread) is legacy. */
const CONVERTED_MODES: ReadonlySet<string> = new Set(["KIT", "AUTO", "MANUAL"]);

/**
 * True when a slice belongs to a converted group, judged from its stored mode.
 *
 * @param slice - A slice read with `sourceAllocation`
 * @returns Whether the mode is KIT, AUTO or MANUAL
 */
export function isConvertedSlice(slice: {
  sourceAllocation?: SourceAllocationMode | string | null;
}): boolean {
  return CONVERTED_MODES.has(slice.sourceAllocation ?? "LEGACY");
}

/** A 500 for a state the database checks forbid: a bug, never user input. */
function sourcesBug(
  message: string,
  additionalData: Record<string, string | number | null>
): ShelfError {
  return new ShelfError({
    cause: null,
    title: "Booking sources",
    message,
    additionalData,
    label: "Booking",
    status: 500,
  });
}

/** One converted kit slice and the quantity the kit gives it now. */
export type KitSliceResize = {
  /** `BookingAsset.id` of a converted (KIT) kit slice on an active booking. */
  sliceId: string;
  /** The slice's asset, locked before the rows are read. */
  assetId: string;
  /** The kit's new quantity for the slice. */
  quantity: number;
};

/** What {@link resizeKitSourceRows} decided. */
export type KitSliceResizeResult = {
  /**
   * Slices whose new quantity is below their units out, with that floor.
   * Non-empty only with `belowOut: "refuse"`, and then nothing was written.
   */
  refused: Array<{ sliceId: string; out: number }>;
  /**
   * The quantity each slice ends with. Equal to the requested one, except with
   * `belowOut: "clamp"` where a slice never drops below its units out. The
   * caller writes this value to `BookingAsset.quantity`.
   */
  quantities: Map<string, number>;
};

/**
 * Resizes the KIT rows of converted kit slices to the kit's new quantity.
 *
 * The current-state rule: the new quantity may not go below the KIT row's
 * units out; above it, an increase is new pending units and a decrease takes
 * pending first, then released. For `Q 5, D 10, S 10` (`out 0, released 5`)
 * raising to 6 adds one pending unit, and lowering back to 5 removes it.
 *
 * Takes the asset lock of every slice (idempotent for a caller that holds it),
 * reads the KIT rows after it, and writes every changed row in one
 * `writeSourcePlan` call. The caller writes `BookingAsset.quantity` in the same
 * transaction; the deferred checks compare the two at commit.
 *
 * Queries: none for an empty call; else the lock, the KIT rows, and the write.
 *
 * @param tx - The caller's transaction
 * @param args.organizationId - The trusted workspace id
 * @param args.slices - Converted kit slices on active bookings, with their new quantity
 * @param args.belowOut - `refuse` for an edit the user chose (nothing is
 *   written when any slice is refused), `clamp` for an involuntary change such
 *   as destroyed units (the slice keeps its units out)
 * @returns The refused slices and the quantity each slice ends with
 * @throws {ShelfError} 500 when a converted kit slice has no KIT row
 */
export async function resizeKitSourceRows(
  tx: BookingSourcesTx,
  args: {
    organizationId: string;
    slices: KitSliceResize[];
    belowOut: "refuse" | "clamp";
  }
): Promise<KitSliceResizeResult> {
  const { organizationId, slices, belowOut } = args;
  const result: KitSliceResizeResult = { refused: [], quantities: new Map() };
  if (slices.length === 0) return result;

  await lockGroupAssets(
    tx,
    organizationId,
    slices.map((s) => s.assetId)
  );
  const rows = await tx.bookingAssetSource.findMany({
    where: {
      organizationId,
      bookingAssetId: { in: slices.map((s) => s.sliceId) },
      kind: "KIT",
    },
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
  const rowBySlice = new Map(rows.map((r) => [r.bookingAssetId, r]));

  const upsertRows: SourceRowWrite[] = [];
  for (const slice of slices) {
    const row = rowBySlice.get(slice.sliceId);
    if (!row) {
      throw sourcesBug("A converted kit slice has no KIT source row.", {
        sliceId: slice.sliceId,
      });
    }
    // The share sum plays no part in a resize; the writer re-reads it.
    const state: SourceRowState = { ...row, sharedQuantity: 0 };
    let resized = resizeKitRow(state, slice.quantity);
    if (!resized.ok) {
      if (belowOut === "refuse") {
        result.refused.push({ sliceId: slice.sliceId, out: resized.out });
        continue;
      }
      resized = resizeKitRow(state, resized.out);
      if (!resized.ok) continue; // unreachable: resizing to out always fits
    }
    const next = resized.row;
    result.quantities.set(slice.sliceId, next.quantity);
    if (
      next.quantity === row.quantity &&
      next.releasedQuantity === row.releasedQuantity
    ) {
      continue;
    }
    upsertRows.push({
      bookingAssetId: slice.sliceId,
      kind: "KIT",
      locationId: null,
      quantity: next.quantity,
      outQuantity: next.outQuantity,
      releasedQuantity: next.releasedQuantity,
      dispatchedTotal: next.dispatchedTotal,
    });
  }
  if (result.refused.length > 0) return result;

  await writeSourcePlan(tx, {
    organizationId,
    plan: {
      upsertRows,
      deleteRowIds: [],
      insertShares: [],
      repointShares: [],
      setModes: [],
    },
  });
  return result;
}

/**
 * The assets a kit detach path must lock for its memberships: those of every
 * given membership that has a converted slice (every membership when
 * adoption is on, since a LEGACY group may then convert). One statement, no
 * lock. Memberships outside the workspace are never matched, so a foreign
 * `AssetKit` id reads nothing.
 *
 * A path that takes another asset lock first (a kit edit's archive guard)
 * runs this as the first statement of its transaction and puts the result in
 * that lock, so {@link lockKitDetachPools} later re-locks rows it holds.
 *
 * @param tx - The caller's transaction
 * @param args.organizationId - The trusted workspace id
 * @param args.assetKitIds - The memberships whose slices the path may delete
 *   or detach
 * @param args.adoptionEnabled - Defaults to `BOOKING_SOURCES_ENABLED`
 * @returns Distinct asset ids to lock; empty when nothing needs the lock
 */
export async function probeKitDetachPools(
  tx: BookingSourcesTx,
  args: {
    organizationId: string;
    assetKitIds: string[];
    adoptionEnabled?: boolean;
  }
): Promise<string[]> {
  const { organizationId } = args;
  const assetKitIds = [...new Set(args.assetKitIds)];
  if (assetKitIds.length === 0) return [];
  const adoptionEnabled = args.adoptionEnabled ?? BOOKING_SOURCES_ENABLED;

  // `BookingAsset_assetKitId_idx` serves the EXISTS probe per membership.
  const rows = await tx.$queryRaw<Array<{ assetId: string }>>(Prisma.sql`
    SELECT DISTINCT ak."assetId" AS "assetId"
    FROM "AssetKit" ak
    WHERE ak.id = ANY(${assetKitIds}::text[])
      AND ak."organizationId" = ${organizationId}
      AND (
        ${adoptionEnabled}::boolean
        OR EXISTS (
          SELECT 1 FROM "BookingAsset" ba
          WHERE ba."assetKitId" = ak.id
            AND ba."sourceAllocation" <> 'LEGACY'
        )
      )`);
  return (rows ?? []).flatMap((r) =>
    typeof r.assetId === "string" ? [r.assetId] : []
  );
}

/**
 * The one asset lock a kit detach path takes, before it deletes or detaches
 * any kit slice: one sorted statement over the assets
 * {@link probeKitDetachPools} returns. Every later lock in the path (the
 * detach, a resize) is a re-lock of rows this statement already holds, so the
 * path never locks assets in two batches.
 *
 * LEGACY slices with adoption off cost the probe and no lock. INDIVIDUAL
 * members are locked too when adoption is on: the sources detach that follows
 * locks every candidate slice's asset, whatever its type, so leaving them out
 * here would make that a second batch.
 *
 * @param tx - The caller's transaction
 * @param args.organizationId - The trusted workspace id
 * @param args.assetKitIds - The memberships whose slices the path may delete
 *   or detach
 * @param args.adoptionEnabled - Defaults to `BOOKING_SOURCES_ENABLED`
 * @returns Ids of the locked assets; empty when nothing needed the lock
 */
export async function lockKitDetachPools(
  tx: BookingSourcesTx,
  args: {
    organizationId: string;
    assetKitIds: string[];
    adoptionEnabled?: boolean;
  }
): Promise<Set<string>> {
  const assetIds = await probeKitDetachPools(tx, args);
  if (assetIds.length === 0) return new Set();
  await lockGroupAssets(tx, args.organizationId, assetIds);
  return new Set(assetIds);
}

/** A kit slice about to lose its kit, as the kit service read it. */
export type DetachingKitSlice = {
  /** `BookingAsset.id`. */
  id: string;
  bookingId: string;
  assetId: string;
  /** The stored mode; a slice read without it counts as LEGACY. */
  sourceAllocation?: SourceAllocationMode | string | null;
};

/** The row of a slice for a source, created empty when absent. */
function rowFor(slice: WorkingSlice, kind: SourceRowState["kind"]): WorkingRow {
  const key = sourceKey({ kind, locationId: null });
  let row = slice.rows.find((r) => sourceKey(r) === key);
  if (!row) {
    row = {
      kind,
      locationId: null,
      quantity: 0,
      outQuantity: 0,
      releasedQuantity: 0,
      dispatchedTotal: 0,
      sharedQuantity: 0,
    };
    slice.rows.push(row);
  }
  return row;
}

/**
 * Splits one kit slice's KIT row into the slice that keeps its units: the
 * slice itself (it becomes AUTO) or its standalone sibling.
 *
 * - out units and the whole history (`dispatchedTotal` and its shares) go to
 *   the target's UNKNOWN row;
 * - released units go to the target's UNASSIGNED row;
 * - pending units are allocated from loose sources, the rest on UNASSIGNED,
 *   on an active booking; on a finished booking (which holds nothing) they
 *   go straight to UNASSIGNED.
 *
 * Shares on the persisted KIT row are listed in `repoints`; shares this
 * session seeds for it are re-aimed in place.
 */
async function splitKitSlice(
  tx: BookingSourcesTx,
  session: GroupSession,
  group: WorkingGroup,
  kit: WorkingSlice,
  target: WorkingSlice,
  active: boolean,
  repoints: SourcePlanWrite["repointShares"]
): Promise<void> {
  const kitRow = kit.rows.find((r) => r.kind === "KIT");
  if (!kitRow) {
    throw sourcesBug("A converted kit slice has no KIT source row.", {
      sliceId: kit.id,
    });
  }
  const kitKey = sourceKey(kitRow);
  const out = kitRow.outQuantity;
  const released = kitRow.releasedQuantity;
  const pending = pendingOf(kitRow);
  const dispatched = kitRow.dispatchedTotal;
  const shared = kitRow.sharedQuantity;

  // The KIT row ends empty: a persisted one is zeroed and dropped by the
  // writer once its shares have moved; one seeded in this session is never
  // written.
  if (kitRow.id) {
    Object.assign(kitRow, {
      quantity: 0,
      outQuantity: 0,
      releasedQuantity: 0,
      dispatchedTotal: 0,
      sharedQuantity: 0,
    });
  } else {
    kit.rows = kit.rows.filter((r) => r !== kitRow);
  }

  if (target === kit) {
    kit.mode = "AUTO";
    kit.assetKitId = null;
  } else {
    target.quantity += kit.quantity;
  }

  const unknownKey = sourceKey({ kind: "UNKNOWN", locationId: null });
  if (out > 0 || dispatched > 0 || shared > 0) {
    const unknown = rowFor(target, "UNKNOWN");
    unknown.quantity += out;
    unknown.outQuantity += out;
    unknown.dispatchedTotal += dispatched;
    unknown.sharedQuantity += shared;
  }
  if (kitRow.id && shared > 0) {
    repoints.push({
      fromRowId: kitRow.id,
      toBookingAssetId: target.id,
      toKey: unknownKey,
    });
  }
  for (const share of group.insertShares) {
    if (share.bookingAssetId === kit.id && share.sourceKey === kitKey) {
      share.bookingAssetId = target.id;
      share.sourceKey = unknownKey;
    }
  }

  if (released > 0) {
    const unassigned = rowFor(target, "UNASSIGNED");
    unassigned.quantity += released;
    unassigned.releasedQuantity += released;
  }

  if (pending <= 0) return;
  if (!active) {
    addToRow(target, "UNASSIGNED", null, pending);
    return;
  }
  // A MANUAL sibling keeps to the sources it uses now, as a resize of it
  // would; see manualSourceKeys for the unrestricted fallback.
  await allocateToSlice(
    tx,
    session,
    group,
    target,
    pending,
    "involuntary",
    manualSourceKeys(target)
  );
}

/**
 * Keeps source rows right for kit slices about to lose their kit. Call it
 * before the slices are merged into a standalone sibling or the `AssetKit`
 * delete clears their `assetKitId`.
 *
 * Per group (one asset on one booking):
 * - a converted group: each detaching KIT slice is split (see the module
 *   doc). With a standalone sibling (`assetKitId IS NULL`) its parts merge
 *   into that sibling; the caller then adds the slice's `quantity` and
 *   `checkedOutQuantity` to the sibling and deletes the slice. Without one
 *   the slice becomes AUTO.
 * - a LEGACY group on an active booking with adoption on converts first, in
 *   the same plan, and is then split the same way. A held-back group stays
 *   LEGACY and detaches as today.
 * - any other LEGACY group is left alone.
 *
 * Takes the asset lock of the candidate pools (one sorted statement; a
 * re-lock of the set {@link lockKitDetachPools} already holds), then reads the
 * bookings and every group after it. A booking in `finishingBookingIds` (a
 * check-in completing it in this transaction) counts as finished whatever its
 * stored status. Pending units on an active booking are allocated over the
 * rest of its window (from now on); allocation never refuses.
 *
 * Queries: none when adoption is off and every slice is LEGACY. Otherwise the
 * lock, the bookings, then per booking the group session (`loadGroupStates`,
 * and free units for an active booking), and one write for the whole call.
 *
 * @param tx - The caller's transaction
 * @param args.organizationId - The trusted workspace id; slices of bookings
 *   outside it are ignored
 * @param args.kitSlices - The kit slices about to lose their kit
 * @param args.finishingBookingIds - Bookings this transaction is finishing
 * @param args.adoptionEnabled - Defaults to `BOOKING_SOURCES_ENABLED`
 * @param args.now - The current time, for the allocation window
 * @returns Ids of the detaching slices whose group ends converted: a merge
 *   into a sibling of one of them must carry `checkedOutQuantity`
 */
export async function detachKitSliceSources(
  tx: BookingSourcesTx,
  args: {
    organizationId: string;
    kitSlices: DetachingKitSlice[];
    finishingBookingIds?: readonly string[];
    adoptionEnabled?: boolean;
    now?: Date;
  }
): Promise<{ convertedSliceIds: Set<string> }> {
  const { organizationId } = args;
  const adoptionEnabled = args.adoptionEnabled ?? BOOKING_SOURCES_ENABLED;
  const now = args.now ?? new Date();
  const finishing = new Set(args.finishingBookingIds ?? []);
  const convertedSliceIds = new Set<string>();

  const candidates = adoptionEnabled
    ? args.kitSlices
    : args.kitSlices.filter((slice) => isConvertedSlice(slice));
  if (candidates.length === 0) return { convertedSliceIds };

  // Lock first: the booking statuses and every group are read after it.
  const pools = await lockGroupAssets(
    tx,
    organizationId,
    candidates.map((s) => s.assetId)
  );
  const bookings = await tx.booking.findMany({
    where: {
      id: { in: [...new Set(candidates.map((s) => s.bookingId))] },
      organizationId,
    },
    select: { id: true, status: true, from: true, to: true },
  });
  const bookingById = new Map(bookings.map((b) => [b.id, b]));
  const isActive = (booking: { id: string; status: BookingStatus }) =>
    !finishing.has(booking.id) &&
    KIT_PROPAGATION_STATUSES.includes(booking.status);

  // LEGACY slices only matter where they may convert: an active booking.
  const relevant = candidates.filter((slice) => {
    const booking = bookingById.get(slice.bookingId);
    if (!booking || !pools.has(slice.assetId)) return false;
    return isConvertedSlice(slice) || isActive(booking);
  });
  if (relevant.length === 0) return { convertedSliceIds };

  const detachingIds = new Set(relevant.map((s) => s.id));
  const assetsByBooking = new Map<string, Set<string>>();
  for (const slice of relevant) {
    const set = assetsByBooking.get(slice.bookingId) ?? new Set<string>();
    set.add(slice.assetId);
    assetsByBooking.set(slice.bookingId, set);
  }

  const plan: SourcePlanWrite = {
    upsertRows: [],
    deleteRowIds: [],
    insertShares: [],
    repointShares: [],
    setModes: [],
  };
  for (const [bookingId, assetIds] of assetsByBooking) {
    const booking = bookingById.get(bookingId);
    if (!booking) continue;
    const active = isActive(booking);
    const session = await openGroupSession(tx, {
      organizationId,
      groups: [...assetIds].map((assetId) => ({ bookingId, assetId })),
      adoptionEnabled: adoptionEnabled && active,
      window: settlementWindow(booking, now),
      loadFree: active,
    });
    // Conversion seeds pending units on standalone slices; a detach is
    // involuntary, so they are placed without refusing.
    await allocateSessionPending(tx, session, "involuntary");

    for (const assetId of assetIds) {
      const group = session.groups.get(groupMapKey({ bookingId, assetId }));
      if (!group || group.status !== "converted") continue;
      const sibling = group.slices.find(
        (s) => s.assetKitId === null && !detachingIds.has(s.id)
      );
      const detaching = group.slices.filter(
        (s) => detachingIds.has(s.id) && s.mode === "KIT"
      );
      for (const kit of detaching) {
        await splitKitSlice(
          tx,
          session,
          group,
          kit,
          sibling ?? kit,
          active,
          plan.repointShares
        );
        convertedSliceIds.add(kit.id);
      }
    }

    const sessionPlan = buildSessionPlan(session);
    plan.upsertRows.push(...sessionPlan.upsertRows);
    plan.insertShares.push(...sessionPlan.insertShares);
    plan.setModes.push(...sessionPlan.setModes);
  }
  await writeSourcePlan(tx, { organizationId, plan });
  return { convertedSliceIds };
}

/** A kit slice just created on a booking, as the kit service wrote it. */
export type NewKitSlice = {
  bookingId: string;
  assetId: string;
  /** The new membership the slice was created for (`AssetKit.id`). */
  assetKitId: string;
};

/**
 * Gives kit slices just added to bookings by a kit membership change their
 * sources, the way `allocateNewSlices` (booking-sources.server.ts) treats a
 * kit slice a booking adds: in a converted group the slice becomes KIT with one KIT row holding
 * its quantity; in a LEGACY group on an active booking with adoption on, the
 * group converts first (held back: it stays LEGACY), its seeded pending units
 * are placed without refusing, and the slice is adopted the same way. Any
 * other LEGACY group is left alone.
 *
 * A new kit slice has nothing out, so it needs no allocation and no
 * admission. Kit paths take asset locks only: this takes the asset lock of
 * the pools concerned (a re-lock for a caller that holds it) and reads the
 * bookings, the slices and every group after it.
 *
 * Queries: with adoption off, one probe for converted groups among the
 * slices' (booking, asset) pairs, and nothing else when there is none.
 * Otherwise the lock, the bookings, the new slices, then per booking the
 * group session, and one write for the whole call.
 *
 * @param tx - The caller's transaction
 * @param args.organizationId - The trusted workspace id; bookings outside it
 *   are ignored
 * @param args.kitSlices - The kit slices just created, each keyed by its
 *   booking and new membership
 * @param args.adoptionEnabled - Defaults to `BOOKING_SOURCES_ENABLED`
 * @param args.now - The current time, for the allocation window
 * @returns Ids of the new slices whose group ends converted
 */
export async function seedKitRowsForNewKitSlices(
  tx: BookingSourcesTx,
  args: {
    organizationId: string;
    kitSlices: NewKitSlice[];
    adoptionEnabled?: boolean;
    now?: Date;
  }
): Promise<{ convertedSliceIds: Set<string> }> {
  const { organizationId, kitSlices } = args;
  const adoptionEnabled = args.adoptionEnabled ?? BOOKING_SOURCES_ENABLED;
  const now = args.now ?? new Date();
  const convertedSliceIds = new Set<string>();
  if (kitSlices.length === 0) return { convertedSliceIds };

  const pairKey = (slice: { bookingId: string; assetId: string }) =>
    groupMapKey({ bookingId: slice.bookingId, assetId: slice.assetId });

  // Converted groups among the pairs. The new slices are stored LEGACY, so
  // only a slice the group already had can match.
  let candidates = kitSlices;
  if (!adoptionEnabled) {
    const converted = await tx.bookingAsset.findMany({
      where: {
        booking: { organizationId },
        sourceAllocation: { not: "LEGACY" },
        OR: kitSlices.map((s) => ({
          bookingId: s.bookingId,
          assetId: s.assetId,
        })),
      },
      select: { bookingId: true, assetId: true },
      distinct: ["bookingId", "assetId"],
    });
    const convertedPairs = new Set(converted.map(pairKey));
    candidates = kitSlices.filter((s) => convertedPairs.has(pairKey(s)));
    if (candidates.length === 0) return { convertedSliceIds };
  }

  // Lock first: the bookings, the slices and every group are read after it.
  const pools = await lockGroupAssets(
    tx,
    organizationId,
    candidates.map((s) => s.assetId)
  );
  const bookings = await tx.booking.findMany({
    where: {
      id: { in: [...new Set(candidates.map((s) => s.bookingId))] },
      organizationId,
    },
    select: { id: true, status: true, from: true, to: true },
  });
  const bookingById = new Map(bookings.map((b) => [b.id, b]));
  const created = await tx.bookingAsset.findMany({
    where: {
      bookingId: { in: [...bookingById.keys()] },
      assetKitId: { in: [...new Set(candidates.map((s) => s.assetKitId))] },
    },
    select: { id: true, bookingId: true, assetId: true, assetKitId: true },
  });
  const wanted = new Set(
    candidates.map((s) => `${s.bookingId}:${s.assetKitId}`)
  );
  const newSlices = created.filter(
    (s) => pools.has(s.assetId) && wanted.has(`${s.bookingId}:${s.assetKitId}`)
  );
  if (newSlices.length === 0) return { convertedSliceIds };

  const newSliceIds = new Set(newSlices.map((s) => s.id));
  const assetsByBooking = new Map<string, Set<string>>();
  for (const slice of newSlices) {
    const set = assetsByBooking.get(slice.bookingId) ?? new Set<string>();
    set.add(slice.assetId);
    assetsByBooking.set(slice.bookingId, set);
  }

  const plan: SourcePlanWrite = {
    upsertRows: [],
    deleteRowIds: [],
    insertShares: [],
    repointShares: [],
    setModes: [],
  };
  for (const [bookingId, assetIds] of assetsByBooking) {
    const booking = bookingById.get(bookingId);
    if (!booking) continue;
    const active = KIT_PROPAGATION_STATUSES.includes(booking.status);
    const session = await openGroupSession(tx, {
      organizationId,
      groups: [...assetIds].map((assetId) => ({ bookingId, assetId })),
      adoptionEnabled: adoptionEnabled && active,
      window: settlementWindow(booking, now),
      newSliceIds,
      loadFree: active,
    });
    // Conversion seeds pending units on standalone slices; the kit change is
    // not the booking's choice, so they are placed without refusing.
    await allocateSessionPending(tx, session, "involuntary");

    for (const assetId of assetIds) {
      const group = session.groups.get(groupMapKey({ bookingId, assetId }));
      if (!group || group.status !== "converted") continue;
      for (const slice of group.slices) {
        if (newSliceIds.has(slice.id)) convertedSliceIds.add(slice.id);
      }
    }

    const sessionPlan = buildSessionPlan(session);
    plan.upsertRows.push(...sessionPlan.upsertRows);
    plan.insertShares.push(...sessionPlan.insertShares);
    plan.setModes.push(...sessionPlan.setModes);
  }
  // Every group stayed LEGACY (held back, or a finished booking): no write.
  if (
    plan.upsertRows.length === 0 &&
    plan.insertShares.length === 0 &&
    plan.setModes.length === 0
  ) {
    return { convertedSliceIds };
  }
  await writeSourcePlan(tx, { organizationId, plan });
  return { convertedSliceIds };
}
