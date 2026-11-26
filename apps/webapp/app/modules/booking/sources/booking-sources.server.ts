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
 * With adoption off, a booking with no converted group stops after one
 * probe: every slice stays LEGACY and nothing is read, locked or written.
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
 * {@link dispatchUnits} is the check-out path: it sends units out of the rows
 * (by allocation, or from the operator's chosen source) and checks units
 * leaving now against what is physically on hand.
 *
 * {@link openSettlement} and {@link commitSettlement} are the check-in path:
 * units that come back or are used up are settled on the rows they were out
 * from (see `settlement.ts`), and every disposition log gets its shares.
 *
 * {@link getSliceSourceSummaries} is the read-only display path: no lock, no
 * conversion.
 *
 * @see {@link file://./conversion.server.ts} conversion and the group session
 * @see {@link file://./capacity.server.ts} free units, capacity and holds
 */

import { AssetType, BookingStatus, Prisma } from "@prisma/client";
import {
  allocateSources,
  computeShortSlices,
  decreaseSliceQuantity,
  describeBookingSources,
  dispatchFromRow,
  pendingOf,
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
  BOOKING_DISPOSITION_CATEGORIES,
  isBookingDispositionCategory,
} from "../checkout-attribution";
import {
  computeFreeBySourceForPools,
  loadCompetingHoldsByPool,
  loadPhysicalNow,
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
  WorkingRow,
  WorkingSlice,
} from "./conversion.server";
import { resizeKitRow } from "./kit-quantity";
import { groupMapKey, writeSourcePlan } from "./repository.server";
import {
  emptySettlement,
  matchSharesToLogs,
  settlementWindow,
} from "./settlement";
import type { Settlement, UnsharedLog } from "./settlement";
import { shortageWindow } from "./shortage-window";
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
  /**
   * The booking's stored start and creation time: its short-sweep priority.
   * Unread (epoch) in an empty context, which has no group to sweep.
   */
  booking: { from: Date; createdAt: Date };
};

/**
 * The window a call measures over: fixed by the caller, or derived from the
 * booking's stored start and end as read under the booking lock.
 */
type CallWindow = Window | ((booking: { from: Date; to: Date }) => Window);

/**
 * A context with no group: every touched slice stays LEGACY, nothing is
 * planned and {@link finishCall} writes nothing.
 */
function emptyCallContext(organizationId: string): CallContext {
  return {
    session: { organizationId, groups: new Map(), pending: [] },
    groupBySlice: new Map(),
    isDraft: false,
    booking: { from: new Date(0), createdAt: new Date(0) },
  };
}

/**
 * True when any group of the booking is converted: a slice that is not
 * LEGACY, or a share row (shares outlive their slices, so a group whose
 * slices were all removed stays converted). One statement, three EXISTS
 * probes, each led by `bookingId` on an existing index. `BookingAsset` has
 * no plain `bookingId` index, only the two partial uniques, so the slice
 * lookup is split on `assetKitId` to match them: standalone slices probe
 * `BookingAsset_manual_unique` (`bookingId`, `assetId`) WHERE `assetKitId`
 * IS NULL, kit slices probe `BookingAsset_kit_unique` (`bookingId`,
 * `assetKitId`) WHERE `assetKitId` IS NOT NULL. The share lookup probes
 * `BookingDispositionShare_bookingId_assetId_idx`. Booking-wide on purpose:
 * a superset of the touched groups only sends a call down the full path,
 * never the other way.
 *
 * @param tx - The caller's transaction
 * @param organizationId - The trusted workspace id
 * @param bookingId - The booking
 */
async function bookingHasConvertedGroup(
  tx: BookingSourcesTx,
  organizationId: string,
  bookingId: string
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ converted: boolean }>>(Prisma.sql`
    SELECT (
      EXISTS (
        SELECT 1 FROM "BookingAsset" ba
        JOIN "Booking" b ON b.id = ba."bookingId"
        WHERE ba."bookingId" = ${bookingId}
          AND ba."assetKitId" IS NULL
          AND b."organizationId" = ${organizationId}
          AND ba."sourceAllocation" <> 'LEGACY'
      )
      OR EXISTS (
        SELECT 1 FROM "BookingAsset" ba
        JOIN "Booking" b ON b.id = ba."bookingId"
        WHERE ba."bookingId" = ${bookingId}
          AND ba."assetKitId" IS NOT NULL
          AND b."organizationId" = ${organizationId}
          AND ba."sourceAllocation" <> 'LEGACY'
      )
      OR EXISTS (
        SELECT 1 FROM "BookingDispositionShare" sh
        WHERE sh."bookingId" = ${bookingId}
          AND sh."organizationId" = ${organizationId}
      )
    ) AS "converted"`);
  return rows[0]?.converted === true;
}

/**
 * Whether a booking's pool sources take part in a transaction: true when
 * adoption is enabled (LEGACY groups convert as they are touched), otherwise
 * true only when the booking already has a converted group.
 *
 * A writer that makes several source calls in one transaction asks this once,
 * after the booking lock, and passes the answer to each call as
 * `sourcesInPlay`. When it is false, the writer skips every source read, lock
 * and call: every slice of the booking is LEGACY and stays LEGACY, so the
 * writer behaves exactly as it does without source rows. The answer holds for
 * the rest of the transaction: the booking lock keeps any other writer from
 * converting a group of this booking, and with adoption off this transaction
 * converts nothing either.
 *
 * Queries: none with adoption on; one probe otherwise.
 *
 * @param tx - The caller's transaction; the caller holds the booking lock
 * @param args.organizationId - The trusted workspace id
 * @param args.bookingId - The booking
 * @param args.adoptionEnabled - Defaults to `BOOKING_SOURCES_ENABLED`
 * @returns True when the caller must run its source work
 */
export async function bookingSourcesInPlay(
  tx: BookingSourcesTx,
  args: {
    organizationId: string;
    bookingId: string;
    adoptionEnabled?: boolean;
  }
): Promise<boolean> {
  if (args.adoptionEnabled ?? BOOKING_SOURCES_ENABLED) return true;
  return bookingHasConvertedGroup(tx, args.organizationId, args.bookingId);
}

/**
 * Steps 1 and 2 of every write: read the touched slices and the booking's
 * status, lock the assets, open the session.
 *
 * With adoption off, a booking with no converted group has nothing to plan:
 * one probe ({@link bookingHasConvertedGroup}) and an empty context, without
 * the slice, booking, lock, state or free-unit reads. Every slice is then
 * LEGACY to the caller, and a slice id that is not on the booking is not
 * reported (nothing is written for it either). A caller that already asked
 * {@link bookingSourcesInPlay} in this transaction passes its answer as
 * `sourcesInPlay` and the probe is not sent again: false returns the empty
 * context at once, true goes straight to the reads.
 *
 * Only quantity-tracked assets are read and locked when `sliceIds` is
 * omitted: an INDIVIDUAL asset has no source rows, and a caller that locked
 * the booking's pool assets in one sorted statement beforehand finds this
 * lock already held (no second lock set, so no lock-order inversion). A
 * caller that holds that lock passes `assetsLocked` and the statement is not
 * sent again.
 *
 * @param tx - The caller's transaction; the caller holds the booking lock
 * @param args.sliceIds - Slices to touch; every quantity-tracked slice of the
 *   booking when omitted
 * @param args.assetIds - With `sliceIds` omitted, only the quantity-tracked
 *   slices of these assets
 * @param args.window - The session window, or how to derive it from the
 *   booking's stored dates
 * @param args.assetsLocked - True when the caller already holds the sorted
 *   asset lock of every touched quantity-tracked asset; only with `sliceIds`
 *   omitted (the slice read then keeps to quantity-tracked assets)
 * @param args.sourcesInPlay - The caller's {@link bookingSourcesInPlay}
 *   answer for this transaction; probed here when omitted
 * @throws {ShelfError} 404 when a slice is not on this booking in this
 *   workspace; not raised when adoption is off and the booking has no
 *   converted group (the call returns the empty context first)
 */
async function openCall(
  tx: BookingSourcesTx,
  args: {
    organizationId: string;
    bookingId: string;
    sliceIds?: string[];
    assetIds?: string[];
    window: CallWindow;
    adoptionEnabled: boolean;
    newSliceIds?: ReadonlySet<string>;
    assetsLocked?: boolean;
    sourcesInPlay?: boolean;
  }
): Promise<CallContext> {
  const { organizationId, bookingId, sliceIds } = args;
  const inPlay =
    args.sourcesInPlay ??
    (args.adoptionEnabled ||
      (await bookingHasConvertedGroup(tx, organizationId, bookingId)));
  if (!inPlay) return emptyCallContext(organizationId);

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
          : {
              asset: { type: AssetType.QUANTITY_TRACKED },
              ...(args.assetIds ? { assetId: { in: args.assetIds } } : {}),
            }),
      },
      select: { id: true, assetId: true },
    }),
    tx.booking.findFirst({
      where: { id: bookingId, organizationId },
      select: { status: true, from: true, to: true, createdAt: true },
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

  const sliceAssetIds = [...new Set(slices.map((s) => s.assetId))];
  // The slice read keeps to quantity-tracked assets when `sliceIds` is
  // omitted, so a caller's held lock covers exactly these.
  const pools =
    args.assetsLocked && !sliceIds
      ? new Set(sliceAssetIds)
      : await lockGroupAssets(tx, organizationId, sliceAssetIds);
  const assetIds = sliceAssetIds.filter((id) => pools.has(id));
  const window =
    typeof args.window === "function"
      ? args.window({ from: booking.from, to: booking.to })
      : args.window;
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
    booking: { from: booking.from, createdAt: booking.createdAt },
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

/**
 * Step 5: one write for the whole call. An empty context (no group opened)
 * has nothing to write and sends nothing.
 */
async function finishCall(tx: BookingSourcesTx, ctx: CallContext) {
  if (ctx.session.groups.size === 0) return;
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
 * @param args.sourcesInPlay - The writer's {@link bookingSourcesInPlay} answer
 *   for this transaction; probed here when omitted
 * @throws {ShelfError} 400 naming each source's free units; 404 for
 *   a slice not on this booking, except when adoption is off and the booking
 *   has no converted group (nothing is planned or written then)
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
    sourcesInPlay?: boolean;
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
 * @param args.sourcesInPlay - The writer's {@link bookingSourcesInPlay} answer
 *   for this transaction; probed here when omitted
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
    sourcesInPlay?: boolean;
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
 * @param args.sourcesInPlay - The writer's {@link bookingSourcesInPlay} answer
 *   for this transaction; probed here when omitted
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
    sourcesInPlay?: boolean;
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
 * @param args.sourcesInPlay - The writer's {@link bookingSourcesInPlay} answer
 *   for this transaction; probed here when omitted
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
    sourcesInPlay?: boolean;
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
 * @param args.sourcesInPlay - The writer's {@link bookingSourcesInPlay} answer
 *   for this transaction; probed here when omitted
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
    sourcesInPlay?: boolean;
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
    sourcesInPlay: args.sourcesInPlay,
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

/** One slice a check-out sends units out of. */
export type DispatchPick = {
  /** The slice (`BookingAsset.id`). */
  sliceId: string;
  /**
   * Units leaving now. The caller adds the same number to the slice's
   * `checkedOutQuantity` in the same transaction, so the rows'
   * `dispatchedTotal` keeps summing to it.
   */
  units: number;
  /**
   * The operator's choice for this dispatch: a manual placement's location
   * id, or null for the unplaced units. Omitted to dispatch by allocation.
   */
  fromLocationId?: string | null;
};

/** Units of one slice that left from one loose source in a dispatch. */
export type DispatchedSource = {
  kind: "LOCATION" | "UNPLACED";
  /** Set for a location; null for the unplaced units. */
  locationId: string | null;
  /** The location's name, or "Unplaced". */
  name: string;
  /** Units that left from this source in this dispatch. */
  quantity: number;
};

/** Where one converted slice's units left from in a dispatch. */
export type DispatchedSlice = {
  sliceId: string;
  assetId: string;
  /** Loose sources only; units of a kit slice leave from its KIT row. */
  sources: DispatchedSource[];
};

/** What {@link dispatchUnits} did. */
export type DispatchResult = {
  /** Every converted slice that sent units out, with the sources used. */
  dispatched: DispatchedSlice[];
  /**
   * Picked slices the facade left alone: their group stays LEGACY (adoption
   * off, or held back), or the asset is not quantity-tracked. The caller
   * records their source the LEGACY way.
   */
  legacySliceIds: string[];
};

/** Display name of the unplaced units, in summaries and refusals. */
const UNPLACED_NAME = "Unplaced";

/** Units taken from each source key of one slice in this dispatch. */
type Taken = Map<string, number>;

/** A refusal for units asked beyond what the slice holds; a caller bug. */
function overBooked(sliceId: string): ShelfError {
  return userError(
    "More units were asked to go out than this booking item holds.",
    { sliceId }
  );
}

/** LOCATION rows in row order, then the UNPLACED row: the dispatch order. */
function knownRowsInDispatchOrder(slice: WorkingSlice): WorkingRow[] {
  return [
    ...slice.rows.filter((r) => r.kind === "LOCATION"),
    ...slice.rows.filter((r) => r.kind === "UNPLACED"),
  ];
}

/** A slice whose pending units sit at more than one loose source. */
function isSplitSlice(slice: WorkingSlice): boolean {
  return (
    slice.rows.filter((r) => LOOSE_KINDS.has(r.kind) && pendingOf(r) > 0)
      .length > 1
  );
}

/** Sends `k` units out of one known row and records them as taken. */
function dispatchRow(row: WorkingRow, k: number, taken: Taken) {
  if (k <= 0) return;
  Object.assign(row, dispatchFromRow(row, k).row);
  taken.set(sourceKey(row), (taken.get(sourceKey(row)) ?? 0) + k);
}

/** Location names by id, in one query; empty input reads nothing. */
async function locationNames(
  tx: BookingSourcesTx,
  organizationId: string,
  ids: Array<string | null>
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => id !== null))];
  if (unique.length === 0) return new Map();
  const rows = await tx.location.findMany({
    where: { id: { in: unique }, organizationId },
    select: { id: true, name: true },
  });
  return new Map(rows.map((l) => [l.id, l.name]));
}

/** The name of a loose source key, for messages. */
function sourceName(key: string, names: Map<string, string>): string {
  const [kind, locationId] = key.split(":");
  if (kind === "UNPLACED") return UNPLACED_NAME;
  return names.get(locationId) ?? "Unknown location";
}

/**
 * The 400 a short slice gets at check-out, naming the source it is short at
 * and saying it needs a location, or saying how many of its units have none.
 *
 * @param shortKeys - Loose source keys the slice is short at
 */
async function buildShortRefusal(
  tx: BookingSourcesTx,
  organizationId: string,
  group: WorkingGroup,
  slice: WorkingSlice,
  shortKeys: ReadonlySet<string>
): Promise<ShelfError> {
  const [asset, names] = await Promise.all([
    tx.asset.findFirst({
      // eslint-disable-next-line local-rules/require-archived-at-check-on-asset-queries -- why: names an asset already on this booking in a refusal; archived or not
      where: { id: group.key.assetId, organizationId },
      select: { title: true },
    }),
    locationNames(
      tx,
      organizationId,
      [...shortKeys].map((key) => key.split(":")[1] || null)
    ),
  ]);
  const title = asset?.title ?? "This asset";
  const message =
    shortKeys.size > 0
      ? `${title} is short at ${[...shortKeys]
          .map((key) => sourceName(key, names))
          .join(
            ", "
          )} and needs a location. Change where its units come from, then check out again.`
      : `${title} needs a location for ${unassignedPending(
          slice
        )} units. Choose where they come from, then check out again.`;
  return userError(message, { sliceId: slice.id, ...group.key });
}

/**
 * The short rule, the same for a dispatch by allocation and from a chosen
 * source: a slice is refused only when units leaving now come from a source
 * the short sweep flags for it. Units with no source (pending on UNASSIGNED)
 * are refused where they would leave, in {@link dispatchByAllocation}.
 *
 * @param taken - Units taken from each source key of the slice in this call
 * @param shortKeys - Loose source keys the slice is short at
 * @throws {ShelfError} 400 naming the short sources the units left from
 */
async function assertNotLeavingShort(
  tx: BookingSourcesTx,
  organizationId: string,
  group: WorkingGroup,
  slice: WorkingSlice,
  taken: Taken,
  shortKeys: ReadonlySet<string>
) {
  const leavingShort = new Set(
    [...taken.keys()].filter((key) => shortKeys.has(key))
  );
  if (leavingShort.size > 0) {
    throw await buildShortRefusal(
      tx,
      organizationId,
      group,
      slice,
      leavingShort
    );
  }
}

/**
 * Sends units of a slice out by its allocation: pending units first, from
 * LOCATION rows in row order and then the UNPLACED row; beyond pending,
 * released units on those rows in the same order (a re-claim); then released
 * units on the UNASSIGNED row, first given a known source by the allocation
 * rule against the free units left for this booking.
 *
 * Units beyond the known rows' pending would come from pending on UNASSIGNED,
 * which has no source yet: refused as needing a location. Pending on
 * UNASSIGNED that the dispatch does not reach stays where it is.
 *
 * @param shortKeys - Loose source keys the slice is short at
 * @throws {ShelfError} 400 when units leaving need a location or leave a
 *   short source, or the released units on UNASSIGNED fit no source
 */
async function dispatchByAllocation(
  tx: BookingSourcesTx,
  organizationId: string,
  group: WorkingGroup,
  slice: WorkingSlice,
  units: number,
  shortKeys: ReadonlySet<string>,
  taken: Taken
) {
  let left = units;
  const known = knownRowsInDispatchOrder(slice);
  for (const row of known) {
    const k = Math.min(pendingOf(row), left);
    dispatchRow(row, k, taken);
    left -= k;
  }
  if (left > 0 && unassignedPending(slice) > 0) {
    throw await buildShortRefusal(tx, organizationId, group, slice, new Set());
  }
  for (const row of known) {
    const k = Math.min(row.releasedQuantity, left);
    dispatchRow(row, k, taken);
    left -= k;
  }
  const unassigned = slice.rows.find((r) => r.kind === "UNASSIGNED");
  const movable = Math.min(unassigned?.releasedQuantity ?? 0, left);
  if (unassigned && movable > 0) {
    // Released units on UNASSIGNED are re-claimed only after their share of
    // the plan moves to a known row, admitted like any added demand.
    const result = allocateSources({
      quantity: movable,
      sources: availableForBooking(group),
    });
    if (!result.ok) {
      throw await buildSourceRefusal(
        tx,
        organizationId,
        group.key,
        result.freeBySource
      );
    }
    unassigned.quantity -= movable;
    unassigned.releasedQuantity -= movable;
    for (const part of result.parts) {
      addToRow(slice, part.kind, part.locationId, part.quantity);
      const row = slice.rows.find((r) => sourceKey(r) === sourceKey(part));
      if (row) dispatchRow(row, part.quantity, taken);
    }
    left -= movable;
  }
  if (left > 0) throw overBooked(slice.id);
  await assertNotLeavingShort(
    tx,
    organizationId,
    group,
    slice,
    taken,
    shortKeys
  );
}

/**
 * Sends units of a slice out from the source the operator chose. Taken from
 * that source's pending units when they cover the dispatch. Otherwise the
 * missing units of the plan move into that source first (pending units from
 * UNASSIGNED, then from the other known rows, last in dispatch order first;
 * then the source's own released units are re-claimed; then released units
 * of the other rows move in), and the slice becomes MANUAL when pending or
 * released units moved. The admission check after every pick decides whether
 * the source can take them. Never replaces the slice's whole split: rows the
 * dispatch does not need keep their units.
 *
 * Moving pending units off UNASSIGNED into the source gives them that
 * source, so a slice needing a location may still go out from a choice.
 *
 * @throws {ShelfError} 400 when the source is not a placement of the pool, or
 *   the slice is short there
 */
async function dispatchFromChoice(
  tx: BookingSourcesTx,
  organizationId: string,
  group: WorkingGroup,
  slice: WorkingSlice,
  units: number,
  fromLocationId: string | null,
  shortKeys: ReadonlySet<string>,
  taken: Taken
) {
  const kind = fromLocationId === null ? "UNPLACED" : "LOCATION";
  const key = sourceKey({ kind, locationId: fromLocationId });
  if (!group.free.some((s) => sourceKey(s) === key)) {
    throw userError("The chosen location does not hold this asset.", {
      sliceId: slice.id,
    });
  }
  let row = slice.rows.find((r) => sourceKey(r) === key);
  if (!row) {
    row = {
      kind,
      locationId: fromLocationId,
      quantity: 0,
      outQuantity: 0,
      releasedQuantity: 0,
      dispatchedTotal: 0,
      sharedQuantity: 0,
    };
    slice.rows.push(row);
  }
  const target = row;

  let need = Math.max(0, units - pendingOf(target));
  let moved = false;
  const unassignedRows = slice.rows.filter((r) => r.kind === "UNASSIGNED");
  const otherKnown = knownRowsInDispatchOrder(slice)
    .filter((r) => r !== target)
    .reverse();
  for (const other of [...unassignedRows, ...otherKnown]) {
    const t = Math.min(pendingOf(other), need);
    if (t <= 0) continue;
    other.quantity -= t;
    target.quantity += t;
    need -= t;
    moved = true;
  }
  // The source's own released units are re-claimed by the dispatch itself.
  need -= Math.min(target.releasedQuantity, need);
  for (const other of [...otherKnown, ...unassignedRows]) {
    const t = Math.min(other.releasedQuantity, need);
    if (t <= 0) continue;
    other.quantity -= t;
    other.releasedQuantity -= t;
    target.quantity += t;
    target.releasedQuantity += t;
    need -= t;
    moved = true;
  }
  if (need > 0) throw overBooked(slice.id);
  if (moved) slice.mode = "MANUAL";
  dispatchRow(target, units, taken);
  await assertNotLeavingShort(
    tx,
    organizationId,
    group,
    slice,
    taken,
    shortKeys
  );
}

/**
 * Short source keys per slice of one group, by the short sweep over the
 * window: other active bookings' holds plus this booking's own rows, units
 * out granted first, pending units by priority. Pending units on UNASSIGNED
 * are reported by {@link unassignedPending}, not here.
 */
function shortKeysBySlice(
  group: WorkingGroup,
  args: {
    capacity: Map<string, number>;
    competing: SourceHold[];
    bookingId: string;
    booking: { from: Date; createdAt: Date };
    window: Window;
  }
): Map<string, Set<string>> {
  const own: SourceHold[] = [];
  const unassignedPendingBySlice = new Map<string, number>();
  for (const slice of group.slices) {
    if (slice.mode !== "AUTO" && slice.mode !== "MANUAL") continue;
    for (const row of slice.rows) {
      const pending = Math.max(0, pendingOf(row));
      if (row.kind === "UNASSIGNED" && pending > 0) {
        unassignedPendingBySlice.set(
          slice.id,
          (unassignedPendingBySlice.get(slice.id) ?? 0) + pending
        );
      }
      if (!LOOSE_KINDS.has(row.kind) || row.outQuantity + pending === 0) {
        continue;
      }
      own.push({
        sliceId: slice.id,
        sourceKey: sourceKey(row),
        bookingFrom: args.booking.from,
        bookingCreatedAt: args.booking.createdAt,
        bookingId: args.bookingId,
        from: args.window.from,
        to: args.window.to,
        out: row.outQuantity,
        pending,
      });
    }
  }
  const result = new Map<string, Set<string>>();
  for (const shortage of computeShortSlices({
    capacityBySource: args.capacity,
    holds: [...args.competing, ...own],
    unassignedPendingBySlice,
  })) {
    if (
      !shortage.sourceKey.startsWith("LOCATION:") &&
      !shortage.sourceKey.startsWith("UNPLACED:")
    ) {
      continue;
    }
    const keys = result.get(shortage.sliceId) ?? new Set<string>();
    keys.add(shortage.sourceKey);
    result.set(shortage.sliceId, keys);
  }
  return result;
}

/**
 * Sends units of a booking's slices out (check-out, on every surface).
 *
 * Converted slices dispatch from their rows, in one plan written once:
 * - KIT slices from their KIT row (no admission, no physical check: kit units
 *   stay under the kit and pool checks);
 * - AUTO and MANUAL slices by allocation (pending first from LOCATION rows in
 *   row order then UNPLACED, then re-claims of released units), or from the
 *   source the operator chose (see `fromLocationId` on {@link DispatchPick}).
 *   A client that does not announce the `booking-sources` capability
 *   (`clientSupportsSources: false`) is never asked about a split slice, so
 *   any choice it sends for one is ignored and the slice dispatches by
 *   allocation.
 *
 * A LEGACY group touched here converts first when adoption is enabled, and
 * the pending units it seeds are allocated and admitted (voluntary). A slice
 * whose group stays LEGACY is returned in `legacySliceIds` for the caller.
 *
 * Refusals (400, nothing written), in the order checked:
 * - units leaving now from a source the short sweep flags for the slice, or
 *   units that would come from pending on UNASSIGNED, name the source or say
 *   the slice needs a location (one rule for allocation and for a choice; a
 *   choice may first move UNASSIGNED pending into the chosen source);
 * - a re-claim or a move into the chosen source must fit the free units over
 *   the rest of the window `[max(from, now), to)`, naming the source and its
 *   free units. When nothing remains of the window (now at or past `to`),
 *   neither this nor the short rule applies;
 * - units leaving a loose source now must be there now (physical-now):
 *   `Only 3 units are at Demo Warehouse right now.`
 *
 * Queries beyond {@link openCall}: when an AUTO or MANUAL slice is picked,
 * capacity (three), competing holds (two) and physical-now (four to six) in
 * one parallel round; location names for the summary (one, only with
 * LOCATION sources); the write.
 *
 * @param tx - The caller's transaction; the caller holds the booking lock and
 *   locked every picked slice's asset in its first sorted asset lock
 * @param args.organizationId - The trusted workspace id
 * @param args.bookingId - The booking
 * @param args.picks - Units per slice leaving now, quantity-tracked slices
 * @param args.window - The booking window the check-out commits
 * @param args.clientSupportsSources - False for a client without the
 *   `booking-sources` capability; defaults to true
 * @param args.now - The current time (defaults to now)
 * @param args.adoptionEnabled - Defaults to `BOOKING_SOURCES_ENABLED`
 * @param args.sourcesInPlay - The writer's {@link bookingSourcesInPlay} answer
 *   for this transaction; probed here when omitted
 * @returns The sources each converted slice dispatched from, and the slices
 *   left LEGACY
 * @throws {ShelfError} 400 as listed above; 404 for a slice not on this
 *   booking, except when adoption is off and the booking has no converted
 *   group (every pick is then returned as LEGACY)
 */
export async function dispatchUnits(
  tx: BookingSourcesTx,
  args: {
    organizationId: string;
    bookingId: string;
    picks: DispatchPick[];
    window: Window;
    clientSupportsSources?: boolean;
    now?: Date;
    adoptionEnabled?: boolean;
    sourcesInPlay?: boolean;
  }
): Promise<DispatchResult> {
  const { organizationId, bookingId } = args;
  const picks = args.picks.filter((p) => p.units > 0);
  if (picks.length === 0) return { dispatched: [], legacySliceIds: [] };
  const clientSupportsSources = args.clientSupportsSources ?? true;
  const now = args.now ?? new Date();

  // Re-claims and moves are admitted, and sources swept, over the rest of the
  // window (the shortage window the booking page reads too). Once now reaches
  // its end (an overdue check-out) nothing remains of it: nothing is admitted
  // or swept, and the empty window [now, now) counts no other booking's
  // holds. Physical-now still guards the units leaving.
  const { window, over: windowOver } = shortageWindow(args.window, now);

  const ctx = await openCall(tx, {
    organizationId,
    bookingId,
    sliceIds: [...new Set(picks.map((p) => p.sliceId))],
    window,
    adoptionEnabled: args.adoptionEnabled ?? BOOKING_SOURCES_ENABLED,
    sourcesInPlay: args.sourcesInPlay,
  });
  await allocateSessionPending(tx, ctx.session, "voluntary");

  const converted = picks.flatMap((pick) => {
    const found = convertedSlice(ctx, pick.sliceId);
    return found ? [{ pick, ...found }] : [];
  });
  const legacySliceIds = picks
    .filter((pick) => !convertedSlice(ctx, pick.sliceId))
    .map((pick) => pick.sliceId);
  if (converted.length === 0) return { dispatched: [], legacySliceIds };

  const looseAssetIds = [
    ...new Set(
      converted
        .filter(({ slice }) => slice.mode === "AUTO" || slice.mode === "MANUAL")
        .map(({ group }) => group.key.assetId)
    ),
  ];
  let capacity = new Map<string, Map<string, number>>();
  let holdsByPool = new Map<string, SourceHold[]>();
  let physical = new Map<string, Map<string, number>>();
  if (looseAssetIds.length > 0) {
    [capacity, holdsByPool, physical] = await Promise.all([
      loadSourceCapacity(tx, { organizationId, assetIds: looseAssetIds }),
      windowOver
        ? Promise.resolve(new Map<string, SourceHold[]>())
        : loadCompetingHoldsByPool(tx, {
            organizationId,
            assetIds: looseAssetIds,
            window,
            excludeBookingId: bookingId,
          }),
      loadPhysicalNow(tx, { organizationId, assetIds: looseAssetIds }),
    ]);
  }

  const groups = [...new Set(converted.map(({ group }) => group))];
  const shortByGroup = new Map(
    groups.map((group) => [
      group,
      windowOver
        ? new Map<string, Set<string>>()
        : shortKeysBySlice(group, {
            capacity: capacity.get(group.key.assetId) ?? new Map(),
            competing: holdsByPool.get(group.key.assetId) ?? [],
            bookingId,
            booking: ctx.booking,
            window,
          }),
    ])
  );
  const holdsBefore = new Map(groups.map((g) => [g, ownHoldBySource(g)]));

  const takenBySlice = new Map<string, Taken>();
  for (const { pick, group, slice } of converted) {
    const taken = takenBySlice.get(slice.id) ?? new Map<string, number>();
    takenBySlice.set(slice.id, taken);
    if (slice.mode === "KIT") {
      const kitRow = slice.rows.find((r) => r.kind === "KIT");
      if (!kitRow || pick.units > pendingOf(kitRow) + kitRow.releasedQuantity) {
        throw overBooked(slice.id);
      }
      dispatchRow(kitRow, pick.units, taken);
      continue;
    }
    const shortKeys =
      shortByGroup.get(group)?.get(slice.id) ?? new Set<string>();
    const choice =
      pick.fromLocationId !== undefined &&
      (clientSupportsSources || !isSplitSlice(slice))
        ? pick.fromLocationId
        : undefined;
    if (choice !== undefined) {
      await dispatchFromChoice(
        tx,
        organizationId,
        group,
        slice,
        pick.units,
        choice,
        shortKeys,
        taken
      );
      continue;
    }
    await dispatchByAllocation(
      tx,
      organizationId,
      group,
      slice,
      pick.units,
      shortKeys,
      taken
    );
  }

  // Re-claims and moves add to the booking's hold at a source: admitted
  // against the free units over the rest of the window, when any remains.
  for (const group of windowOver ? [] : groups) {
    const before = holdsBefore.get(group) ?? new Map<string, number>();
    const freeByKey = new Map<string, RefusalEntry>(
      group.free.map((s) => [sourceKey(s), s])
    );
    const refused: RefusalEntry[] = [];
    for (const [key, held] of ownHoldBySource(group)) {
      const previous = before.get(key) ?? 0;
      if (held <= previous || held <= (freeByKey.get(key)?.free ?? 0)) {
        continue;
      }
      const entry = refusalEntryFor(group, key, freeByKey);
      if (entry) {
        refused.push({ ...entry, free: Math.max(0, entry.free - previous) });
      }
    }
    if (refused.length > 0) {
      throw await buildSourceRefusal(tx, organizationId, group.key, refused);
    }
  }

  // Physical-now: units leaving a loose source must be on hand there now.
  const leaving = new Map<string, Map<string, number>>();
  for (const { group, slice } of converted) {
    for (const [key, units] of takenBySlice.get(slice.id) ?? []) {
      if (!key.startsWith("LOCATION:") && !key.startsWith("UNPLACED:")) {
        continue;
      }
      const perKey =
        leaving.get(group.key.assetId) ?? new Map<string, number>();
      perKey.set(key, (perKey.get(key) ?? 0) + units);
      leaving.set(group.key.assetId, perKey);
    }
  }
  const shortNow: Array<{ key: string; onHand: number }> = [];
  for (const [assetId, perKey] of leaving) {
    for (const [key, units] of perKey) {
      const onHand = physical.get(assetId)?.get(key) ?? 0;
      if (units > onHand) shortNow.push({ key, onHand: Math.max(0, onHand) });
    }
  }
  const allKeys = [
    ...shortNow.map((s) => s.key),
    ...[...takenBySlice.values()].flatMap((t) => [...t.keys()]),
  ];
  const names = await locationNames(
    tx,
    organizationId,
    allKeys
      .filter((key) => key.startsWith("LOCATION:"))
      .map((key) => key.split(":")[1])
  );
  if (shortNow.length > 0) {
    throw userError(
      shortNow
        .map(({ key, onHand }) =>
          key.startsWith("UNPLACED:")
            ? `Only ${onHand} units are unplaced right now.`
            : `Only ${onHand} units are at ${sourceName(key, names)} right now.`
        )
        .join(" "),
      { bookingId }
    );
  }

  reallocateConflictingAutoSlices(
    ctx.session,
    new Set(converted.map(({ slice }) => slice.id))
  );
  await finishCall(tx, ctx);

  const dispatched: DispatchedSlice[] = [];
  for (const { group, slice } of converted) {
    const taken = takenBySlice.get(slice.id);
    if (!taken || dispatched.some((d) => d.sliceId === slice.id)) continue;
    const sources: DispatchedSource[] = [];
    for (const [key, quantity] of taken) {
      const [kind, locationId] = key.split(":");
      if (kind !== "LOCATION" && kind !== "UNPLACED") continue;
      sources.push({
        kind,
        locationId: kind === "LOCATION" ? locationId : null,
        name: sourceName(key, names),
        quantity,
      });
    }
    dispatched.push({ sliceId: slice.id, assetId: group.key.assetId, sources });
  }
  return { dispatched, legacySliceIds };
}

/**
 * Opens the check-in settlement of a booking: the group session, the
 * conversion of LEGACY groups (adoption on), and the allocation of seeded
 * pending units. Writes nothing; {@link commitSettlement} writes.
 *
 * Call it right after the booking lock and the check-in's one sorted asset
 * lock, before any read that decides what comes back and before any log is
 * written: conversion seeds shares from the logs it reads here, and every
 * log written after it gets RECORDED shares at the commit.
 *
 * A check-in never refuses for capacity: seeded pending units are allocated
 * by the rule over `settlementWindow` of the booking's stored dates (read
 * under the booking lock), and what fits nowhere waits on UNASSIGNED. A group
 * held back at the conversion gate, or LEGACY with adoption off, stays LEGACY
 * and its dispositions follow the existing path.
 *
 * Queries: none for no assets. With adoption off and no converted group on
 * the booking, one probe and nothing else (an empty settlement). Otherwise
 * the probe (adoption off only), the slice and booking reads (two), the
 * asset lock (one, skipped with `assetsLocked`), the group states (four) and
 * free units (five, only for converted groups).
 *
 * @param tx - The check-in transaction; the caller holds the booking lock
 *   and the sorted lock of these assets
 * @param args.organizationId - The trusted workspace id
 * @param args.bookingId - The booking
 * @param args.assetIds - The quantity-tracked assets the check-in touches
 * @param args.assetsLocked - True when the caller holds the sorted lock of
 *   every one of `assetIds` (the statement is not sent again)
 * @param args.now - The current time (defaults to now)
 * @param args.adoptionEnabled - Defaults to `BOOKING_SOURCES_ENABLED`
 * @param args.sourcesInPlay - The writer's {@link bookingSourcesInPlay} answer
 *   for this transaction; probed here when omitted
 * @returns The settlement to pass to `settleUnits` and {@link commitSettlement}
 * @throws {ShelfError} 404 when the booking is not in this workspace, except
 *   when adoption is off and the booking has no converted group (the empty
 *   settlement is returned then)
 */
export async function openSettlement(
  tx: BookingSourcesTx,
  args: {
    organizationId: string;
    bookingId: string;
    assetIds: string[];
    assetsLocked?: boolean;
    now?: Date;
    adoptionEnabled?: boolean;
    sourcesInPlay?: boolean;
  }
): Promise<Settlement> {
  const { organizationId, bookingId } = args;
  const assetIds = [...new Set(args.assetIds)];
  if (assetIds.length === 0) {
    return emptySettlement({ organizationId, bookingId });
  }
  const now = args.now ?? new Date();
  const ctx = await openCall(tx, {
    organizationId,
    bookingId,
    assetIds,
    assetsLocked: args.assetsLocked,
    window: (booking) => settlementWindow(booking, now),
    adoptionEnabled: args.adoptionEnabled ?? BOOKING_SOURCES_ENABLED,
    sourcesInPlay: args.sourcesInPlay,
  });
  if (ctx.session.groups.size === 0) {
    return emptySettlement({ organizationId, bookingId });
  }
  await allocateSessionPending(tx, ctx.session, "involuntary");

  const groups = new Map<string, WorkingGroup>();
  for (const group of ctx.session.groups.values()) {
    if (group.status === "converted") groups.set(group.key.assetId, group);
  }
  return {
    organizationId,
    bookingId,
    groups,
    planned: [],
    session: ctx.session,
  };
}

/** A disposition log of the booking that no share covers yet. */
type NewLogRow = {
  id: string;
  assetId: string;
  bookingAssetId: string | null;
  category: string;
  quantity: number;
  createdAt: Date;
};

/**
 * The booking's disposition logs of these assets that have no share at all:
 * one statement, a `NOT EXISTS` on the share's `consumptionLogId` index. A
 * converted group's earlier logs are each fully shared (the commit check),
 * so in a converted group these are the logs this check-in wrote plus, in a
 * group converting now, the logs its conversion seeds in memory.
 *
 * @param tx - The check-in transaction
 * @param args.organizationId - The trusted workspace id
 * @param args.bookingId - The booking
 * @param args.assetIds - The converted groups' assets
 */
async function loadUnsharedDispositionLogs(
  tx: BookingSourcesTx,
  args: { organizationId: string; bookingId: string; assetIds: string[] }
): Promise<NewLogRow[]> {
  return tx.$queryRaw<NewLogRow[]>(Prisma.sql`
    SELECT cl.id, cl."assetId", cl."bookingAssetId", cl.category::text AS category,
           cl.quantity, cl."createdAt"
    FROM "ConsumptionLog" cl
    JOIN "Booking" b ON b.id = cl."bookingId"
    WHERE cl."bookingId" = ${args.bookingId}
      AND b."organizationId" = ${args.organizationId}
      AND cl."assetId" IN (${Prisma.join(args.assetIds)})
      AND cl.category::text IN (${Prisma.join([
        ...BOOKING_DISPOSITION_CATEGORIES,
      ])})
      AND NOT EXISTS (
        SELECT 1 FROM "BookingDispositionShare" sh
        WHERE sh."consumptionLogId" = cl.id
      )`);
}

/**
 * Writes a check-in settlement, after every disposition log of the check-in
 * is written, in the same transaction: the conversion of groups converted by
 * {@link openSettlement}, the settled rows, and one RECORDED share per piece
 * of every new log.
 *
 * The new logs are found, not passed in: the booking's disposition logs of
 * the settlement's converted groups that have no share and that conversion
 * did not just seed ({@link loadUnsharedDispositionLogs}). These are exactly
 * the logs this check-in wrote, including the ledger's CONSUME, LOSS and
 * DAMAGE rows, which split one event over the places the stock left from.
 * Every converted group is read, settled or not, so a log written for a
 * group without settling it is caught.
 *
 * Queries: none for an empty settlement; the new logs (one, only when a
 * group is converted); the write.
 *
 * @param tx - The check-in transaction
 * @param settlement - The settlement from {@link openSettlement}
 * @throws {ShelfError} 500 when the new logs and the settled units disagree
 *   (a writer logged without settling, or settled without logging); nothing
 *   is written
 */
export async function commitSettlement(
  tx: BookingSourcesTx,
  settlement: Settlement
): Promise<void> {
  const { session, organizationId, bookingId } = settlement;
  if (!session) return;
  const plan = buildSessionPlan(session);

  const assetIds = [...settlement.groups.keys()];
  if (assetIds.length > 0) {
    const seeded = new Set(plan.insertShares.map((s) => s.consumptionLogId));
    const logs = await loadUnsharedDispositionLogs(tx, {
      organizationId,
      bookingId,
      assetIds,
    });
    const unshared: UnsharedLog[] = logs.flatMap((log) => {
      const { category } = log;
      if (seeded.has(log.id) || !isBookingDispositionCategory(category)) {
        return [];
      }
      return [{ ...log, category }];
    });
    const match = matchSharesToLogs(settlement.planned, unshared);
    if (!match.ok) {
      throw new ShelfError({
        cause: null,
        title: "Booking sources",
        message:
          "The check-in's records and its returned units do not match. Nothing was saved.",
        additionalData: {
          bookingId,
          organizationId,
          plannedLeft: JSON.stringify(match.plannedLeft),
          logsLeft: JSON.stringify(match.logsLeft),
        },
        label: "Booking",
        status: 500,
      });
    }
    plan.insertShares.push(...match.shares);
  }

  await writeSourcePlan(tx, { organizationId, plan });
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
 * Shortness comes from the short sweep over the shortage window (what is left
 * of the booking's stored window, see `shortage-window.ts`), the window
 * {@link dispatchUnits} refuses over, so a slice shows short exactly when a
 * check-out from that source would refuse: other active bookings' holds plus
 * this booking's own rows (whatever its status), with units out granted
 * first and pending units by priority. Pending units on UNASSIGNED are always
 * short. Once nothing is left of the window, only UNASSIGNED is short and no
 * capacity or competing hold is read. COMPLETE, CANCELLED and ARCHIVED
 * bookings hold nothing, so they are never short: the sweep is skipped and no
 * part is flagged, UNASSIGNED included.
 *
 * Queries: slices with the booking (two, parallel), source rows (one), then
 * capacity (three), competing holds (two) and location names (one) in
 * parallel, whatever the number of pools. A finished booking, or one whose
 * window is over, reads only the location names in that last step.
 *
 * @param args.organizationId - The trusted workspace id
 * @param args.bookingId - The booking
 * @param args.now - The current time (defaults to now)
 * @returns Per slice id
 */
export async function getSliceSourceSummaries(args: {
  organizationId: string;
  bookingId: string;
  now?: Date;
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

  // The stored end, as the check-out reads it: an OVERDUE booking's window is
  // over, so it sweeps nothing, exactly as its check-out admits nothing.
  const { window, over: windowOver } = shortageWindow(
    { from: booking.from, to: booking.to },
    args.now ?? new Date()
  );
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
  // A finished booking holds nothing and plans nothing, so it is never short.
  const reportsShortness =
    booking.status !== "COMPLETE" &&
    booking.status !== "CANCELLED" &&
    booking.status !== "ARCHIVED";
  // Over an empty window only UNASSIGNED is short: nothing else is read.
  const sweeps = reportsShortness && !windowOver;
  const [capacity, holdsByPool, locations] = await Promise.all([
    sweeps
      ? loadSourceCapacity(db, { organizationId, assetIds })
      : Promise.resolve(null),
    sweeps
      ? loadCompetingHoldsByPool(db, {
          organizationId,
          assetIds,
          window,
          excludeBookingId: bookingId,
        })
      : Promise.resolve(null),
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
    if (!capacity || !holdsByPool) {
      for (const slice of assetSlices) {
        const parts = describeBookingSources({
          rows: assetRows.filter((r) => r.bookingAssetId === slice.id),
          locationNames,
          shortSourceKeys: new Set(),
        });
        // UNASSIGNED pending units flag themselves short: kept while the
        // booking holds, cleared on a finished booking.
        const shown = reportsShortness
          ? parts
          : parts.map((part) => ({ ...part, short: false }));
        result.set(slice.id, {
          parts: shown,
          short: shown.some((part) => part.short),
          mode: slice.sourceAllocation,
        });
      }
      continue;
    }
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
        // The stored start is the sweep priority, as on the check-out.
        bookingFrom: booking.from,
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
