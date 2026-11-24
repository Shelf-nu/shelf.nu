/**
 * Booking sources facade: the one entry point every booking path calls to
 * keep a quantity-tracked pool's source rows right.
 *
 * Each write function runs inside the caller's transaction, after the caller
 * locked the booking row. It then:
 * 1. reads which assets the call touches (the booking lock keeps that set
 *    stable) and takes the asset lock once, sorted and workspace-scoped,
 *    before any read that decides conversion or allocation;
 * 2. opens a group session ({@link openGroupSession}): converts LEGACY groups
 *    when adoption is enabled, adopts slices added to converted groups;
 * 3. applies its change in memory, admitting every voluntary increase against
 *    free units over the window;
 * 4. re-allocates, silently, every AUTO slice of the touched groups whose
 *    holds no longer fit its sources, when another set of sources fits
 *    (MANUAL slices are never moved and stay flagged short);
 * 5. writes everything in one `writeSourcePlan` call. Every refusal is thrown
 *    before that write.
 *
 * Refusals are `ShelfError` 400 with `shouldBeCaptured: false`, naming each
 * source with its free units. Drafts hold nothing, so a draft's allocation
 * never refuses: units that fit nowhere wait on UNASSIGNED until the booking
 * is reserved, which admits them again.
 *
 * Callers update `BookingAsset.quantity` themselves, after calling
 * {@link resizeSlices}: the facade reads the stored quantity as the pre-change
 * value, which is what conversion seeds from.
 *
 * {@link getSliceSourceSummaries} is the read-only display path: no lock, no
 * conversion.
 *
 * @see {@link file://./conversion.server.ts} conversion and the group session
 * @see {@link file://./capacity.server.ts} free units, capacity and holds
 */

import { AssetType, BookingStatus } from "@prisma/client";
import {
  allocateSources,
  computeShortSlices,
  decreaseSliceQuantity,
  describeBookingSources,
  pendingOf,
  resolveIntervalTo,
  sourceKey,
} from "@shelf/quantity-control";
import type {
  BookingSourcePart,
  SourceHold,
  SourceRowState,
} from "@shelf/quantity-control";

import { db } from "~/database/db.server";
import { BOOKING_SOURCES_ENABLED } from "~/utils/env";
import { ShelfError } from "~/utils/error";

import {
  computeFreeBySourceForPools,
  loadCompetingHoldsByPool,
  loadSourceCapacity,
} from "./capacity.server";
import {
  addToRow,
  allocateSessionPending,
  allocateToSlice,
  applyAllocation,
  availableForBooking,
  buildSessionPlan,
  buildSourceRefusal,
  lockGroupAssets,
  openGroupSession,
  ownHoldBySource,
  sliceOf,
  stripLoosePending,
} from "./conversion.server";
import type {
  AllocationHow,
  BookingSourcesTx,
  GroupSession,
  RefusalEntry,
  WorkingGroup,
  WorkingSlice,
} from "./conversion.server";
import { resizeKitRow } from "./kit-quantity";
import { groupMapKey, writeSourcePlan } from "./repository.server";
import type { SourceAllocationMode, Window } from "./types";

/** Source kinds that hold location or Unplaced capacity. */
const LOOSE_KINDS: ReadonlySet<SourceRowState["kind"]> = new Set([
  "LOCATION",
  "UNPLACED",
]);

/** A 400 the user can act on; never captured. */
function userError(
  message: string,
  additionalData: Record<string, string | number | null>
): ShelfError {
  return new ShelfError({
    cause: null,
    title: "Booking sources",
    message,
    additionalData,
    label: "Booking",
    status: 400,
    shouldBeCaptured: false,
  });
}

/** What one facade call has open: the session and the slices it touches. */
type CallContext = {
  session: GroupSession;
  /** Group of each touched slice, by slice id (quantity-tracked only). */
  groupBySlice: Map<string, WorkingGroup>;
  /** True when the booking is a DRAFT (holds nothing). */
  isDraft: boolean;
};

/**
 * Steps 1 and 2 of every write: read the touched slices and the booking's
 * status, lock the assets, open the session.
 *
 * Only quantity-tracked assets are read and locked when `sliceIds` is
 * omitted: an INDIVIDUAL asset has no source rows, and a caller that locked
 * the booking's pool assets in one sorted statement beforehand finds this
 * lock already held (no second lock set, so no lock-order inversion).
 *
 * @param tx - The caller's transaction; the caller holds the booking lock
 * @param args.sliceIds - Slices to touch; every quantity-tracked slice of the
 *   booking when omitted
 * @throws {ShelfError} 404 when a slice is not on this booking in this workspace
 */
async function openCall(
  tx: BookingSourcesTx,
  args: {
    organizationId: string;
    bookingId: string;
    sliceIds?: string[];
    window: Window;
    adoptionEnabled: boolean;
    newSliceIds?: ReadonlySet<string>;
  }
): Promise<CallContext> {
  const { organizationId, bookingId, sliceIds, window } = args;
  // Reading the slice list before the asset lock is safe: the caller holds
  // the booking lock, so no slice is added or removed meanwhile, and every
  // read that decides anything (slices, rows, logs, shares) runs again under
  // the asset lock in `openGroupSession`.
  const [slices, booking] = await Promise.all([
    tx.bookingAsset.findMany({
      where: {
        bookingId,
        booking: { organizationId },
        ...(sliceIds
          ? { id: { in: sliceIds } }
          : { asset: { type: AssetType.QUANTITY_TRACKED } }),
      },
      select: { id: true, assetId: true },
    }),
    tx.booking.findFirst({
      where: { id: bookingId, organizationId },
      select: { status: true },
    }),
  ]);
  const wanted = sliceIds ? new Set(sliceIds) : null;
  if (!booking || (wanted && slices.length !== wanted.size)) {
    throw new ShelfError({
      cause: null,
      message: "Booking or booking item not found",
      additionalData: { bookingId, organizationId },
      label: "Booking",
      status: 404,
      shouldBeCaptured: false,
    });
  }

  const pools = await lockGroupAssets(
    tx,
    organizationId,
    slices.map((s) => s.assetId)
  );
  const assetIds = [...new Set(slices.map((s) => s.assetId))].filter((id) =>
    pools.has(id)
  );
  const session = await openGroupSession(tx, {
    organizationId,
    groups: assetIds.map((assetId) => ({ bookingId, assetId })),
    adoptionEnabled: args.adoptionEnabled,
    window,
    newSliceIds: args.newSliceIds,
    loadFree: true,
  });

  const groupBySlice = new Map<string, WorkingGroup>();
  for (const s of slices) {
    const group = session.groups.get(
      groupMapKey({ bookingId, assetId: s.assetId })
    );
    if (group) groupBySlice.set(s.id, group);
  }
  return {
    session,
    groupBySlice,
    isDraft: booking.status === BookingStatus.DRAFT,
  };
}

/** The converted slice behind a slice id, or null when it stays LEGACY. */
function convertedSlice(
  ctx: CallContext,
  sliceId: string
): { group: WorkingGroup; slice: WorkingSlice } | null {
  const group = ctx.groupBySlice.get(sliceId);
  if (!group || group.status !== "converted") return null;
  return { group, slice: sliceOf(group, sliceId) };
}

/**
 * Sources at which a group's holds no longer fit: this booking's remaining
 * reservation there is above the free units over the window (capacity minus
 * the peak of every other active booking's holds). Every source where the
 * short sweep flags one of the booking's slices is included, and so may be a
 * source where the sweep grants this booking first and a lower-priority
 * booking is the one short; an AUTO slice there is then moved too, but only
 * when it fits elsewhere in full, which frees room for the other booking.
 */
function overcommittedKeys(group: WorkingGroup): Set<string> {
  const freeByKey = new Map(group.free.map((s) => [sourceKey(s), s.free]));
  const over = new Set<string>();
  for (const [key, held] of ownHoldBySource(group)) {
    if (held > (freeByKey.get(key) ?? 0)) over.add(key);
  }
  return over;
}

/** Pending units on a slice's UNASSIGNED rows. */
function unassignedPending(slice: WorkingSlice): number {
  return slice.rows
    .filter((r) => r.kind === "UNASSIGNED")
    .reduce((sum, r) => sum + pendingOf(r), 0);
}

/** True when a slice has pending units at one of the given sources. */
function hasPendingAt(slice: WorkingSlice, keys: Set<string>): boolean {
  return slice.rows.some(
    (r) => LOOSE_KINDS.has(r.kind) && pendingOf(r) > 0 && keys.has(sourceKey(r))
  );
}

/**
 * Tries to move all pending units of an AUTO slice to sources that fit them,
 * by the allocation rule. Leaves the slice as it was when nothing fits.
 *
 * @returns True when the slice was re-allocated
 */
function tryReallocate(group: WorkingGroup, slice: WorkingSlice): boolean {
  const snapshot = slice.rows.map((r) => ({ ...r }));
  const pending = stripLoosePending(slice);
  if (pending === 0) return false;
  const result = allocateSources({
    quantity: pending,
    sources: availableForBooking(group),
  });
  if (!result.ok) {
    slice.rows = snapshot;
    return false;
  }
  applyAllocation(slice, result.parts, 0);
  return true;
}

/**
 * Step 4: every AUTO slice of the session whose holds no longer fit (pending
 * on UNASSIGNED, or pending at a source where the booking holds more than is
 * free) is re-allocated when another set of sources fits. Every short slice
 * is among them: a slice the short sweep flags always holds more at its
 * source than the free units there. MANUAL slices are never moved.
 *
 * @param session - The session
 * @param skip - Slices the call just allocated
 */
function reallocateConflictingAutoSlices(
  session: GroupSession,
  skip: ReadonlySet<string> = new Set()
) {
  for (const group of session.groups.values()) {
    if (group.status !== "converted") continue;
    for (const slice of group.slices) {
      if (slice.mode !== "AUTO" || skip.has(slice.id)) continue;
      const over = overcommittedKeys(group);
      if (unassignedPending(slice) > 0 || hasPendingAt(slice, over)) {
        tryReallocate(group, slice);
      }
    }
  }
}

/** Step 5: one write for the whole call. */
async function finishCall(tx: BookingSourcesTx, ctx: CallContext) {
  await writeSourcePlan(tx, {
    organizationId: ctx.session.organizationId,
    plan: buildSessionPlan(ctx.session),
  });
}

/**
 * Gives slices just added to a booking their sources.
 *
 * Call after creating the slices (stored LEGACY by default), inside the same
 * transaction. A slice added to a converted group, or to a LEGACY group that
 * converts now, is created KIT (one KIT row holding its quantity) or AUTO
 * (allocated by the rule); in a converted group this holds even with
 * adoption off. A slice added to a LEGACY group with adoption off, or to a
 * held-back group, stays LEGACY. New slices are expected to have nothing out.
 *
 * @param tx - The caller's transaction; the caller holds the booking lock
 * @param args.organizationId - The trusted workspace id
 * @param args.bookingId - The booking
 * @param args.sliceIds - The slices just added
 * @param args.window - The booking window, half-open
 * @param args.holdsNow - True for an active booking (admitted, refuses);
 *   false for a draft (never refuses, the rest waits on UNASSIGNED)
 * @param args.adoptionEnabled - Defaults to `BOOKING_SOURCES_ENABLED`
 * @throws {ShelfError} 400 naming each source's free units (rule 7.4); 404 for
 *   a slice not on this booking
 */
export async function allocateNewSlices(
  tx: BookingSourcesTx,
  args: {
    organizationId: string;
    bookingId: string;
    sliceIds: string[];
    window: Window;
    holdsNow: boolean;
    adoptionEnabled?: boolean;
  }
): Promise<void> {
  if (args.sliceIds.length === 0) return;
  const ctx = await openCall(tx, {
    ...args,
    adoptionEnabled: args.adoptionEnabled ?? BOOKING_SOURCES_ENABLED,
    newSliceIds: new Set(args.sliceIds),
  });
  const how: AllocationHow = args.holdsNow ? "voluntary" : "draft";
  await allocateSessionPending(tx, ctx.session, how);
  reallocateConflictingAutoSlices(ctx.session, new Set(args.sliceIds));
  await finishCall(tx, ctx);
}

/**
 * Changes the booked quantity of slices.
 *
 * Call before writing the new `BookingAsset.quantity`: the stored quantity is
 * the pre-change value. KIT slices resize their KIT row (never below out).
 * AUTO and MANUAL slices: an increase is allocated and admitted (a MANUAL
 * slice keeps to the sources it already uses when it has any), a decrease
 * takes pending units first (UNASSIGNED first), then released units, never
 * below out. A slice whose group converts in this call is decreased before
 * its seeded pending units are allocated, and what pending remains is
 * allocated without refusing: a decrease never adds demand. LEGACY slices
 * (LEGACY or held-back groups) are left alone.
 *
 * `admit: false` is for a caller that sets the slice's sources in the same
 * transaction right after ({@link setManualSources} or
 * {@link setAutoSources}), which admit the combined result once. The
 * increase of an AUTO or MANUAL slice then goes to its UNASSIGNED row and
 * pending units conversion seeds are allocated without refusing; nothing is
 * admitted here. Never leave the result like that: pending units on
 * UNASSIGNED are short.
 *
 * @param tx - The caller's transaction; the caller holds the booking lock
 * @param args.changes - New quantity per slice
 * @param args.window - The booking window, half-open
 * @param args.adoptionEnabled - Defaults to `BOOKING_SOURCES_ENABLED`
 * @param args.admit - Defaults to true; false only when sources are set next
 * @throws {ShelfError} 400 when an increase does not fit (admitted calls) or
 *   a decrease goes below the units out
 */
export async function resizeSlices(
  tx: BookingSourcesTx,
  args: {
    organizationId: string;
    bookingId: string;
    changes: Array<{ sliceId: string; quantity: number }>;
    window: Window;
    adoptionEnabled?: boolean;
    admit?: boolean;
  }
): Promise<void> {
  if (args.changes.length === 0) return;
  const admit = args.admit ?? true;
  const ctx = await openCall(tx, {
    ...args,
    sliceIds: args.changes.map((c) => c.sliceId),
    adoptionEnabled: args.adoptionEnabled ?? BOOKING_SOURCES_ENABLED,
  });
  let how: AllocationHow = "voluntary";
  if (!admit) how = "involuntary";
  else if (ctx.isDraft) how = "draft";

  // A decrease adds no demand: it first takes the pending units conversion
  // seeded (they hold no source yet), and whatever pending is left on a
  // shrinking slice is existing demand, allocated without refusing.
  const decreased = new Set<string>();
  for (const change of args.changes) {
    const found = convertedSlice(ctx, change.sliceId);
    if (!found || change.quantity >= found.slice.quantity) continue;
    decreased.add(found.slice.id);
    const item = ctx.session.pending.find((p) => p.sliceId === found.slice.id);
    if (!item) continue;
    const take = Math.min(
      item.quantity,
      found.slice.quantity - change.quantity
    );
    item.quantity -= take;
    found.slice.quantity -= take;
  }
  const allPending = ctx.session.pending;
  ctx.session.pending = allPending.filter((p) => decreased.has(p.sliceId));
  await allocateSessionPending(tx, ctx.session, "involuntary");
  ctx.session.pending = allPending.filter((p) => !decreased.has(p.sliceId));
  await allocateSessionPending(tx, ctx.session, how);

  const touched = new Set<string>();
  for (const change of args.changes) {
    const found = convertedSlice(ctx, change.sliceId);
    if (!found) continue;
    const { group, slice } = found;
    const delta = change.quantity - slice.quantity;
    if (delta === 0) continue;
    touched.add(slice.id);

    if (slice.mode === "KIT") {
      const kitRow = slice.rows.find((r) => r.kind === "KIT");
      if (!kitRow) continue;
      const resized = resizeKitRow(kitRow, change.quantity);
      if (!resized.ok) {
        throw userError(
          `The quantity cannot go below the ${resized.out} units already out.`,
          { sliceId: slice.id }
        );
      }
      Object.assign(kitRow, resized.row);
    } else if (delta > 0 && !admit) {
      // The sources call that follows places and admits these units.
      addToRow(slice, "UNASSIGNED", null, delta);
    } else if (delta > 0) {
      const own = new Set(
        slice.rows.filter((r) => LOOSE_KINDS.has(r.kind)).map(sourceKey)
      );
      const onlyKeys =
        slice.mode === "MANUAL" && own.size > 0 ? own : undefined;
      await allocateToSlice(
        tx,
        ctx.session,
        group,
        slice,
        delta,
        how,
        onlyKeys
      );
    } else {
      const out = slice.rows.reduce((sum, r) => sum + r.outQuantity, 0);
      try {
        const next = decreaseSliceQuantity(slice.rows, -delta);
        slice.rows = slice.rows.map((r, i) => ({ ...r, ...next[i] }));
      } catch {
        throw userError(
          `The quantity cannot go below the ${out} units already out.`,
          { sliceId: slice.id }
        );
      }
    }
    slice.quantity = change.quantity;
  }

  reallocateConflictingAutoSlices(ctx.session, touched);
  await finishCall(tx, ctx);
}

/**
 * The converted standalone slice the row action acts on.
 *
 * @throws {ShelfError} 400 when the slice is LEGACY (adoption off or held
 *   back) or kit-driven
 */
function standaloneSlice(ctx: CallContext, sliceId: string) {
  const found = convertedSlice(ctx, sliceId);
  if (!found || found.slice.mode === "KIT" || found.slice.mode === "LEGACY") {
    throw userError("Sources cannot be chosen for this booking item.", {
      sliceId,
    });
  }
  return found;
}

/**
 * Sets the sources of one standalone slice by hand (the row action, or an
 * explicit check-out choice). The slice becomes MANUAL.
 *
 * `sources` gives the planned units (pending plus out) wanted at each loose
 * source: a location id for a manual placement of the pool, or null for
 * Unplaced. Only pending units move: each source keeps at least the units
 * out from it, and released units stay where they are.
 *
 * The sources must add up to the slice's planned units (`quantity -
 * released`) on its LOCATION, UNPLACED and UNASSIGNED rows. Units out on an
 * UNKNOWN row are excluded: their origin is not a loose source and the user
 * cannot move them. For a slice with nothing out or returned this is its
 * whole quantity.
 *
 * An active booking's change is admitted: at every source that gains units,
 * the booking's whole remaining reservation must fit the free units over the
 * window. A draft is not admitted (it holds nothing).
 *
 * @param tx - The caller's transaction; the caller holds the booking lock
 * @param args.sliceId - The slice
 * @param args.sources - Planned units per source
 * @param args.window - The booking window, half-open
 * @param args.adoptionEnabled - Defaults to `BOOKING_SOURCES_ENABLED`
 * @throws {ShelfError} 400 when a location does not hold this asset, the
 *   split does not add up, a source would lose units that are out, or the
 *   change does not fit
 */
export async function setManualSources(
  tx: BookingSourcesTx,
  args: {
    organizationId: string;
    bookingId: string;
    sliceId: string;
    sources: Array<{ locationId: string | null; quantity: number }>;
    window: Window;
    adoptionEnabled?: boolean;
  }
): Promise<void> {
  const ctx = await openCall(tx, {
    ...args,
    sliceIds: [args.sliceId],
    adoptionEnabled: args.adoptionEnabled ?? BOOKING_SOURCES_ENABLED,
  });
  const how: AllocationHow = ctx.isDraft ? "draft" : "voluntary";
  await allocateSessionPending(tx, ctx.session, how);
  const { group, slice } = standaloneSlice(ctx, args.sliceId);

  // Wanted planned units per source key; every location must be a placement.
  const placementKeys = new Set(group.free.map((s) => sourceKey(s)));
  const wanted = new Map<string, number>();
  for (const s of args.sources) {
    const kind = s.locationId === null ? "UNPLACED" : "LOCATION";
    const key = sourceKey({ kind, locationId: s.locationId });
    if (!Number.isInteger(s.quantity) || s.quantity < 0 || wanted.has(key)) {
      throw userError("Each source needs one whole number of units.", {
        sliceId: slice.id,
      });
    }
    if (!placementKeys.has(key)) {
      throw userError("One of the chosen locations does not hold this asset.", {
        sliceId: slice.id,
      });
    }
    wanted.set(key, s.quantity);
  }

  const movable = slice.rows.filter(
    (r) => LOOSE_KINDS.has(r.kind) || r.kind === "UNASSIGNED"
  );
  const plannedNow = movable.reduce(
    (sum, r) => sum + r.quantity - r.releasedQuantity,
    0
  );
  const plannedWanted = [...wanted.values()].reduce((a, b) => a + b, 0);
  if (plannedWanted !== plannedNow) {
    throw userError(`The sources must add up to ${plannedNow} units.`, {
      sliceId: slice.id,
    });
  }
  for (const row of movable) {
    if (!LOOSE_KINDS.has(row.kind)) continue;
    if ((wanted.get(sourceKey(row)) ?? 0) < row.outQuantity) {
      throw userError(
        "A source cannot have fewer units than are already out from it.",
        { sliceId: slice.id }
      );
    }
  }

  const before = ownHoldBySource(group);
  for (const row of movable) {
    // Keep out and released units, set pending to what is wanted.
    const key = sourceKey(row);
    const target = LOOSE_KINDS.has(row.kind) ? wanted.get(key) ?? 0 : 0;
    row.quantity = row.releasedQuantity + Math.max(target, row.outQuantity);
    wanted.delete(key);
  }
  for (const [key, units] of wanted) {
    if (units === 0) continue;
    const source = group.free.find((s) => sourceKey(s) === key);
    if (!source) continue;
    slice.rows.push({
      kind: source.kind,
      locationId: source.locationId,
      quantity: units,
      outQuantity: 0,
      releasedQuantity: 0,
      dispatchedTotal: 0,
      sharedQuantity: 0,
    });
  }
  slice.mode = "MANUAL";

  if (!ctx.isDraft) {
    const after = ownHoldBySource(group);
    const otherHolds = ownHoldBySource(group, slice.id);
    const refused: RefusalEntry[] = [];
    for (const s of group.free) {
      const key = sourceKey(s);
      const held = after.get(key) ?? 0;
      if (held > (before.get(key) ?? 0) && held > s.free) {
        refused.push({
          kind: s.kind,
          locationId: s.locationId,
          free: s.free - (otherHolds.get(key) ?? 0),
        });
      }
    }
    if (refused.length > 0) {
      throw await buildSourceRefusal(
        tx,
        args.organizationId,
        group.key,
        refused
      );
    }
  }

  reallocateConflictingAutoSlices(ctx.session, new Set([slice.id]));
  await finishCall(tx, ctx);
}

/**
 * Returns one standalone slice to AUTO and re-allocates its pending units by
 * the allocation rule ("Auto" in the dialog). Out and released units stay.
 *
 * @param tx - The caller's transaction; the caller holds the booking lock
 * @param args.sliceId - The slice
 * @param args.window - The booking window, half-open
 * @param args.adoptionEnabled - Defaults to `BOOKING_SOURCES_ENABLED`
 * @throws {ShelfError} 400 when the pending units do not fit (active
 *   bookings), or the slice cannot have sources
 */
export async function setAutoSources(
  tx: BookingSourcesTx,
  args: {
    organizationId: string;
    bookingId: string;
    sliceId: string;
    window: Window;
    adoptionEnabled?: boolean;
  }
): Promise<void> {
  const ctx = await openCall(tx, {
    ...args,
    sliceIds: [args.sliceId],
    adoptionEnabled: args.adoptionEnabled ?? BOOKING_SOURCES_ENABLED,
  });
  const how: AllocationHow = ctx.isDraft ? "draft" : "voluntary";
  await allocateSessionPending(tx, ctx.session, how);
  const { group, slice } = standaloneSlice(ctx, args.sliceId);

  slice.mode = "AUTO";
  const pending = stripLoosePending(slice);
  await allocateToSlice(tx, ctx.session, group, slice, pending, how);

  reallocateConflictingAutoSlices(ctx.session, new Set([slice.id]));
  await finishCall(tx, ctx);
}

/**
 * A refusal entry for a source key of a group: kind and location from the
 * free entry when the source is a placement, else from the booking's own row
 * (a location that is no longer a placement has 0 free).
 */
function refusalEntryFor(
  group: WorkingGroup,
  key: string,
  freeByKey: Map<string, RefusalEntry>
): RefusalEntry | null {
  const source = freeByKey.get(key);
  if (source) return source;
  for (const slice of group.slices) {
    const row = slice.rows.find(
      (r) => LOOSE_KINDS.has(r.kind) && sourceKey(r) === key
    );
    if (row && (row.kind === "LOCATION" || row.kind === "UNPLACED")) {
      return { kind: row.kind, locationId: row.locationId, free: 0 };
    }
  }
  return null;
}

/** Shortfall per source: what the booking holds there beyond the free units. */
function shortfallBySource(
  held: Map<string, number>,
  free: RefusalEntry[]
): Map<string, number> {
  const freeByKey = new Map(free.map((s) => [sourceKey(s), s.free]));
  const result = new Map<string, number>();
  for (const [key, units] of held) {
    result.set(key, Math.max(0, units - (freeByKey.get(key) ?? 0)));
  }
  return result;
}

/**
 * Allocates the pending units conversion seeded in this call over a window
 * other than the session's, without refusing (the rest on UNASSIGNED): one
 * batched free read for every pool with seeded units. Each group's session
 * free units are restored afterwards.
 *
 * @param tx - The caller's transaction
 * @param ctx - The open call; its pending list is emptied
 * @param args.bookingId - The booking, excluded from competing holds
 * @param args.window - The window to allocate over
 */
async function allocateSeededOverRemainingWindow(
  tx: BookingSourcesTx,
  ctx: CallContext,
  args: { bookingId: string; window: Window }
) {
  const groups = [
    ...new Set(
      ctx.session.pending.flatMap((p) => {
        const group = ctx.session.groups.get(p.groupKey);
        return group ? [group] : [];
      })
    ),
  ];
  const freeByPool = await computeFreeBySourceForPools(tx, {
    organizationId: ctx.session.organizationId,
    assetIds: groups.map((g) => g.key.assetId),
    window: args.window,
    excludeBookingId: args.bookingId,
  });
  const sessionFree = new Map(groups.map((g) => [g, g.free]));
  for (const group of groups) {
    group.free = freeByPool.get(group.key.assetId) ?? [];
  }
  try {
    await allocateSessionPending(tx, ctx.session, "involuntary");
  } finally {
    for (const [group, free] of sessionFree) group.free = free;
  }
}

/**
 * Admits a change of a booking's window: new dates, reserving a draft, or an
 * extension.
 *
 * Measured window: `[from, to)` for `dates` and `reserve`;
 * `[max(previous.to, now), to)` for `extend` (time already behind an overdue
 * booking cannot compete). Free units, the allocation of pending units
 * conversion seeds, and AUTO re-allocation are all measured over it.
 *
 * At every source, the shortfall is what the booking holds there (out plus
 * pending) beyond the free units. The change is refused only when it creates
 * or worsens a shortage: the shortfall over the measured window is above the
 * shortfall before the change. Before the change means the previous window
 * for `dates`, and nothing for `reserve` (a draft holds nothing) and `extend`
 * (the booking held nothing in the added time). So a booking already short
 * because stock was lost can still shorten its dates.
 *
 * On `extend`, pending units a converting LEGACY group seeds were accepted
 * for the old window under legacy rules, so they are allocated over the
 * whole remaining window `[max(from, now), to)` without refusing (the rest
 * on UNASSIGNED); that costs one extra batched free read, only when a group
 * converts. Admission still measures only the added interval.
 *
 * AUTO slices that do not fit (or have pending on UNASSIGNED) are first moved
 * to sources that fit when there are any. Pending units still on UNASSIGNED
 * refuse `reserve` (a draft becoming a hold must have every unit placed).
 * Refusals name each source with its free units over the measured window.
 *
 * A draft changing dates is not admitted (it holds nothing); `reserve` always
 * is. LEGACY groups convert first when adoption is enabled.
 *
 * Queries beyond {@link openCall}: one batched free read over the previous
 * window for `dates`, location names on a refusal, and the write.
 *
 * @param tx - The caller's transaction; the caller holds the booking lock
 * @param args.from - The new start
 * @param args.to - The new end
 * @param args.previous - The window before the change
 * @param args.kind - What changed
 * @param args.now - The current time, for extensions (defaults to now)
 * @param args.adoptionEnabled - Defaults to `BOOKING_SOURCES_ENABLED`
 * @throws {ShelfError} 400 naming the sources whose shortage the change creates or worsens
 */
export async function admitWindowChange(
  tx: BookingSourcesTx,
  args: {
    organizationId: string;
    bookingId: string;
    from: Date;
    to: Date;
    previous: Window;
    kind: "dates" | "reserve" | "extend";
    now?: Date;
    adoptionEnabled?: boolean;
  }
): Promise<void> {
  const { organizationId, bookingId, from, to, kind, previous } = args;
  const now = args.now ?? new Date();
  const start =
    kind === "extend"
      ? new Date(Math.max(previous.to.getTime(), now.getTime()))
      : from;
  // An extension whose added time is already behind us adds nothing to admit.
  const measured = start.getTime() < to.getTime();
  const window: Window = measured ? { from: start, to } : { from, to };

  const ctx = await openCall(tx, {
    organizationId,
    bookingId,
    window,
    adoptionEnabled: args.adoptionEnabled ?? BOOKING_SOURCES_ENABLED,
  });
  const voluntary = kind === "reserve" || !ctx.isDraft;

  // On an extension, pending units a converting LEGACY group seeds were
  // already accepted for the old window under legacy rules: they are placed
  // over the whole remaining window without refusing, so a source full
  // before the old end never refuses the extension.
  const seededSliceIds = new Set(ctx.session.pending.map((p) => p.sliceId));
  if (kind === "extend" && measured && ctx.session.pending.length > 0) {
    await allocateSeededOverRemainingWindow(tx, ctx, {
      bookingId,
      window: {
        from: new Date(Math.max(from.getTime(), now.getTime())),
        to,
      },
    });
  }
  await allocateSessionPending(
    tx,
    ctx.session,
    voluntary ? "voluntary" : "draft"
  );

  if (!voluntary || !measured) {
    reallocateConflictingAutoSlices(ctx.session);
    await finishCall(tx, ctx);
    return;
  }

  const converted = [...ctx.session.groups.values()].filter(
    (g) => g.status === "converted"
  );

  // The shortfall before the change, on the booking's holds as they stand.
  const shortfallBefore = new Map<WorkingGroup, Map<string, number>>();
  if (kind === "dates" && converted.length > 0) {
    const previousFree = await computeFreeBySourceForPools(tx, {
      organizationId,
      assetIds: converted.map((g) => g.key.assetId),
      window: previous,
      excludeBookingId: bookingId,
    });
    for (const group of converted) {
      shortfallBefore.set(
        group,
        shortfallBySource(
          ownHoldBySource(group),
          previousFree.get(group.key.assetId) ?? []
        )
      );
    }
  }

  // AUTO slices move to sources that fit the measured window. Slices an
  // extension just converted were placed over the whole remaining window.
  for (const group of converted) {
    const over = overcommittedKeys(group);
    for (const slice of group.slices) {
      if (slice.mode !== "AUTO") continue;
      if (kind === "extend" && seededSliceIds.has(slice.id)) continue;
      if (unassignedPending(slice) > 0 || hasPendingAt(slice, over)) {
        tryReallocate(group, slice);
      }
    }
  }

  for (const group of converted) {
    const freeByKey = new Map<string, RefusalEntry>(
      group.free.map((s) => [sourceKey(s), s])
    );
    const before = shortfallBefore.get(group) ?? new Map<string, number>();
    const after = shortfallBySource(ownHoldBySource(group), group.free);
    const refused: RefusalEntry[] = [];
    for (const [key, shortfall] of after) {
      if (shortfall <= (before.get(key) ?? 0)) continue;
      const entry = refusalEntryFor(group, key, freeByKey);
      if (entry) refused.push(entry);
    }
    const needsLocation =
      kind === "reserve" && group.slices.some((s) => unassignedPending(s) > 0);
    if (refused.length === 0 && needsLocation) {
      refused.push(...availableForBooking(group));
    }
    if (refused.length > 0) {
      throw await buildSourceRefusal(tx, organizationId, group.key, refused);
    }
  }

  await finishCall(tx, ctx);
}

/** What the booking page shows for one slice. */
export type SliceSourceSummary = {
  /** Display parts (KIT rows and empty rows hidden). */
  parts: BookingSourcePart[];
  /** True when any of its pending units cannot be covered. */
  short: boolean;
  /** The slice's mode. */
  mode: SourceAllocationMode;
};

/**
 * Display summary of every slice of a booking: its source parts, whether it
 * is short over the booking window, and its mode. Read-only: no lock and no
 * conversion. LEGACY and KIT slices get no parts and are never short.
 *
 * Shortness comes from the short sweep over the booking window: other active
 * bookings' holds plus this booking's own rows (whatever its status), with
 * units out granted first and pending units by priority. Pending units on
 * UNASSIGNED are always short.
 *
 * Queries: slices with the booking (two, parallel), source rows (one), then
 * capacity (three), competing holds (two) and location names (one) in
 * parallel, whatever the number of pools.
 *
 * @param args.organizationId - The trusted workspace id
 * @param args.bookingId - The booking
 * @returns Per slice id
 */
export async function getSliceSourceSummaries(args: {
  organizationId: string;
  bookingId: string;
}): Promise<Map<string, SliceSourceSummary>> {
  const { organizationId, bookingId } = args;
  const result = new Map<string, SliceSourceSummary>();
  const [booking, slices] = await Promise.all([
    db.booking.findFirst({
      where: { id: bookingId, organizationId },
      select: { id: true, from: true, to: true, status: true, createdAt: true },
    }),
    db.bookingAsset.findMany({
      where: { bookingId, booking: { organizationId } },
      select: { id: true, assetId: true, sourceAllocation: true },
    }),
  ]);
  if (!booking) return result;

  const loose = slices.filter(
    (s) => s.sourceAllocation === "AUTO" || s.sourceAllocation === "MANUAL"
  );
  for (const s of slices) {
    result.set(s.id, { parts: [], short: false, mode: s.sourceAllocation });
  }
  if (loose.length === 0) return result;

  const window: Window = {
    from: booking.from,
    to: resolveIntervalTo(booking.status, booking.to, booking.to),
  };
  const assetIds = [...new Set(loose.map((s) => s.assetId))];
  const rows = await db.bookingAssetSource.findMany({
    where: { organizationId, bookingAssetId: { in: loose.map((s) => s.id) } },
    select: {
      bookingAssetId: true,
      kind: true,
      locationId: true,
      quantity: true,
      outQuantity: true,
      releasedQuantity: true,
    },
  });
  const locationIds = [
    ...new Set(rows.flatMap((r) => (r.locationId ? [r.locationId] : []))),
  ];
  const [capacity, holdsByPool, locations] = await Promise.all([
    loadSourceCapacity(db, { organizationId, assetIds }),
    loadCompetingHoldsByPool(db, {
      organizationId,
      assetIds,
      window,
      excludeBookingId: bookingId,
    }),
    locationIds.length === 0
      ? Promise.resolve([])
      : db.location.findMany({
          where: { id: { in: locationIds }, organizationId },
          select: { id: true, name: true },
        }),
  ]);
  const locationNames = new Map(locations.map((l) => [l.id, l.name]));

  for (const assetId of assetIds) {
    const assetSlices = loose.filter((s) => s.assetId === assetId);
    const sliceIds = new Set(assetSlices.map((s) => s.id));
    const assetRows = rows.filter((r) => sliceIds.has(r.bookingAssetId));
    const own: SourceHold[] = [];
    const unassignedPendingBySlice = new Map<string, number>();
    for (const r of assetRows) {
      const out = r.outQuantity;
      const pending = Math.max(0, r.quantity - r.releasedQuantity - out);
      if (r.kind === "UNASSIGNED") {
        if (pending > 0) {
          unassignedPendingBySlice.set(
            r.bookingAssetId,
            (unassignedPendingBySlice.get(r.bookingAssetId) ?? 0) + pending
          );
        }
        continue;
      }
      if (!LOOSE_KINDS.has(r.kind) || out + pending === 0) continue;
      own.push({
        sliceId: r.bookingAssetId,
        sourceKey: sourceKey(r),
        bookingFrom: window.from,
        bookingCreatedAt: booking.createdAt,
        bookingId,
        from: window.from,
        to: window.to,
        out,
        pending,
      });
    }
    const shortages = computeShortSlices({
      capacityBySource: capacity.get(assetId) ?? new Map(),
      holds: [...(holdsByPool.get(assetId) ?? []), ...own],
      unassignedPendingBySlice,
    }).filter((s) => sliceIds.has(s.sliceId));

    for (const slice of assetSlices) {
      const shortKeys = new Set(
        shortages.filter((s) => s.sliceId === slice.id).map((s) => s.sourceKey)
      );
      result.set(slice.id, {
        parts: describeBookingSources({
          rows: assetRows.filter((r) => r.bookingAssetId === slice.id),
          locationNames,
          shortSourceKeys: shortKeys,
        }),
        short: shortKeys.size > 0,
        mode: slice.sourceAllocation,
      });
    }
  }
  return result;
}
