import { BookingStatus } from "@prisma/client";
import type { BookingSourceAllocation, Prisma } from "@prisma/client";
import { describeBookingSources } from "@shelf/quantity-control";
import type { BookingSourcePart } from "@shelf/quantity-control";
import { db } from "~/database/db.server";
import { recordEvent } from "~/modules/activity-event/service.server";
import { assertAssetQuantityAvailable } from "~/modules/asset/availability.server";
import { createSystemBookingNote } from "~/modules/booking-note/service.server";
import { lockAssetForQuantityUpdate } from "~/modules/consumption-log/quantity-lock.server";
import { createNotes } from "~/modules/note/service.server";
import { getUserByID } from "~/modules/user/service.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import { stripMarkdocDelimiters } from "~/utils/markdoc-sanitize";
import { wrapLinkForNote, wrapUserLinkForNote } from "~/utils/markdoc-wrappers";
import { canManageBookingItems } from "~/utils/permissions/role-access";
import type { RoleAccess } from "~/utils/permissions/role-access";
import {
  resizeSlices,
  setAutoSources,
  setManualSources,
} from "./sources/booking-sources.server";
import type { BookingSourcesInput } from "./sources/sources-input";
import { lockBookingForStatusCheck } from "./utils.server";

/**
 * Booked Quantity Service
 *
 * Changes how many units of a quantity-tracked asset a booking holds, on its
 * STANDALONE slice (`assetKitId IS NULL`). Every surface that edits a booked
 * amount goes through here: the web "Adjust quantity" dialog, the mobile
 * adjust-asset-quantity route, and the mobile add-scanned-assets route, which
 * treats "add an asset that is already on the booking, with a quantity" as
 * this change rather than as a duplicate insert.
 *
 * The rules:
 * - A reduction always passes, even when the pool is already over-committed
 *   by other bookings. Only an increase is measured against what is free in
 *   the booking's own `[from, to]` window, with this booking excluded.
 * - A slice whose units have been checked out (`checkedOutAt` set) keeps its
 *   amount, with one exception: a pool slice with source rows (AUTO or
 *   MANUAL) on an ONGOING or OVERDUE booking may change its pending units
 *   (planned, not yet out). Raising it adds pending units; lowering it may
 *   take pending units only, never units out or already returned. Every
 *   other checked-out slice (LEGACY, or on a booking in another status) is
 *   refused: lowering it would strand units that can no longer be checked
 *   in, and raising it would count units as out that never left.
 * - Pool source rows follow every change: `resizeSlices` runs before the new
 *   `BookingAsset.quantity` is written, because it reads the stored quantity
 *   as the value before the change.
 * - The booking row is locked first, then the asset row, and the slice is
 *   re-read under those locks, so two concurrent edits cannot both pass the
 *   guard.
 * - A set of changes lands together: in a transaction of its own, or inside
 *   the caller's when it must commit with other writes (the mobile re-add).
 *
 * The adjust action ({@link setStandaloneBookedQuantity}) also applies the
 * manage-items status rule against the locked booking status, for web and
 * mobile alike. The mobile re-add runs the add rule in its own path.
 *
 * The adjust action may also choose where the slice's units come from
 * (`sources`): by hand (MANUAL) or back to the allocation rule (AUTO). That
 * change commits with its booking note and `BOOKING_ASSET_SOURCES_CHANGED`
 * event in the same transaction, after any quantity change.
 *
 * A kit-driven slice is never changed here: its amount belongs to the kit.
 *
 * @see {@link file://../../routes/api+/bookings.$bookingId.adjust-asset-quantity.ts} web route
 * @see {@link file://../../routes/api+/mobile+/bookings.adjust-asset-quantity.ts} mobile route
 * @see {@link file://../../routes/api+/mobile+/bookings.add-scanned-assets.ts} mobile re-add
 */

/** One standalone slice and the amount it should hold. */
export type BookedQuantityChange = {
  /** The standalone `BookingAsset` row to change. */
  bookingAssetId: string;
  assetId: string;
  /** The new booked quantity (a positive integer). */
  quantity: number;
  /** Named in the availability error and the activity notes. */
  assetTitle: string;
  unitOfMeasure: string | null;
};

/** Where a change applies: one booking and its window. */
type BookingScope = {
  bookingId: string;
  organizationId: string;
  /** The booking's own window, or null for a dateless booking. */
  window: { from: Date; to: Date } | null;
};

/** What a change did, for the activity notes. */
export type AppliedBookedQuantityChange = {
  assetId: string;
  assetTitle: string;
  previousQuantity: number;
  quantity: number;
};

/** The interactive transaction client `db.$transaction` hands its callback. */
export type BookedQuantityTx = Parameters<
  Parameters<typeof db.$transaction>[0]
>[0];

/** The slice's current amount, whether its units have gone out, its mode. */
type SliceState = {
  quantity: number;
  checkedOutAt: Date | null;
  sourceAllocation: BookingSourceAllocation;
};

/** Booking statuses in which units can be out (check-out has happened). */
const PHYSICAL_STATUSES: ReadonlySet<BookingStatus> = new Set([
  BookingStatus.ONGOING,
  BookingStatus.OVERDUE,
]);

/** True for a slice mode that carries loose source rows. */
function hasLooseSources(mode: BookingSourceAllocation | undefined): boolean {
  return mode === "AUTO" || mode === "MANUAL";
}

/** A 400 the user can act on; never captured. */
function userError(
  title: string,
  message: string,
  additionalData: Record<string, string | number>
): ShelfError {
  return new ShelfError({
    cause: null,
    title,
    message,
    additionalData,
    label: "Booking",
    status: 400,
    shouldBeCaptured: false,
  });
}

/** One source row of a slice, as the guards and the notes read it. */
type SliceSourceRow = {
  kind: "LOCATION" | "UNPLACED" | "UNKNOWN" | "UNASSIGNED" | "KIT";
  locationId: string | null;
  quantity: number;
  outQuantity: number;
  releasedQuantity: number;
};

/** Reads a slice's source rows, scoped to the workspace. */
function readSliceSourceRows(
  tx: Pick<BookedQuantityTx, "bookingAssetSource">,
  organizationId: string,
  bookingAssetId: string
): Promise<SliceSourceRow[]> {
  return tx.bookingAssetSource.findMany({
    where: { organizationId, bookingAssetId },
    select: {
      kind: true,
      locationId: true,
      quantity: true,
      outQuantity: true,
      releasedQuantity: true,
    },
  });
}

/**
 * Refuses a change of a checked-out pool slice that reaches beyond its
 * pending units: the new quantity may not go below the units out plus the
 * units already returned or used up.
 *
 * @throws {ShelfError} 400 naming the lowest quantity allowed
 */
async function assertPendingOnlyChange(
  tx: Pick<BookedQuantityTx, "bookingAssetSource">,
  organizationId: string,
  change: BookedQuantityChange,
  current: number
): Promise<void> {
  if (change.quantity >= current) return;
  const rows = await readSliceSourceRows(
    tx,
    organizationId,
    change.bookingAssetId
  );
  const pending = rows.reduce(
    (sum, r) =>
      sum + Math.max(0, r.quantity - r.releasedQuantity - r.outQuantity),
    0
  );
  const floor = current - pending;
  if (change.quantity < floor) {
    throw userError(
      "Already checked out",
      `Only units of "${change.assetTitle}" that have not been checked out can be removed, so its booked quantity cannot go below ${floor}.`,
      { bookingAssetId: change.bookingAssetId, floor }
    );
  }
}

/**
 * Reads a slice and refuses it when it vanished or a change reaches units
 * that are out. A request equal to the current amount is a no-op and is
 * never refused.
 *
 * @param bookingStatus - The locked booking's status
 * @throws {ShelfError} 404 when the slice is gone, 400 when it is checked out
 *   and the change is not limited to pending units of a pool slice on an
 *   ONGOING or OVERDUE booking
 */
async function readChangeableSlice(
  client: Pick<BookedQuantityTx, "bookingAsset" | "bookingAssetSource">,
  change: BookedQuantityChange,
  scope: { organizationId: string; bookingStatus: BookingStatus }
): Promise<SliceState> {
  const slice = await client.bookingAsset.findUnique({
    where: { id: change.bookingAssetId },
    select: { quantity: true, checkedOutAt: true, sourceAllocation: true },
  });
  if (!slice) {
    throw new ShelfError({
      cause: null,
      title: "Not found",
      message: "This asset is not part of the booking.",
      label: "Booking",
      status: 404,
      shouldBeCaptured: false,
    });
  }
  if (slice.checkedOutAt && slice.quantity !== change.quantity) {
    const pendingEditable =
      hasLooseSources(slice.sourceAllocation) &&
      PHYSICAL_STATUSES.has(scope.bookingStatus);
    if (!pendingEditable) {
      throw userError(
        "Already checked out",
        `Units of "${change.assetTitle}" have already been checked out on this booking, so its booked quantity can no longer change.`,
        { bookingAssetId: change.bookingAssetId }
      );
    }
    await assertPendingOnlyChange(
      client,
      scope.organizationId,
      change,
      slice.quantity
    );
  }
  return slice;
}

/**
 * Applies changes under the booking lock the caller already holds.
 *
 * Asset rows are locked in id order, so two requests touching the same assets
 * cannot deadlock. Each slice is re-read under its lock; a stale-high
 * snapshot would otherwise let an increase pass the directional guard as a
 * reduction. Pool source rows are resized in one facade call before any new
 * quantity is written.
 *
 * `admit: false` when the caller sets the slice's sources next in the same
 * transaction: the resize then admits nothing, and the sources call admits
 * the combined result (new quantity and new split) once.
 */
async function applyChangesUnderBookingLock(
  tx: BookedQuantityTx,
  {
    bookingId,
    organizationId,
    window,
    changes,
    bookingStatus,
    admit = true,
  }: BookingScope & {
    changes: BookedQuantityChange[];
    bookingStatus: BookingStatus;
    admit?: boolean;
  }
): Promise<AppliedBookedQuantityChange[]> {
  const ordered = [...changes].sort((a, b) =>
    a.assetId.localeCompare(b.assetId)
  );
  const applied: AppliedBookedQuantityChange[] = [];
  for (const change of ordered) {
    await lockAssetForQuantityUpdate(tx, change.assetId, organizationId);
    const slice = await readChangeableSlice(tx, change, {
      organizationId,
      bookingStatus,
    });

    await assertAssetQuantityAvailable({
      assetId: change.assetId,
      organizationId,
      tx,
      window,
      excludeBookingId: bookingId,
      currentQuantity: slice.quantity,
      requestedQuantity: change.quantity,
      assetTitle: change.assetTitle,
      unitOfMeasure: change.unitOfMeasure,
    });

    applied.push({
      assetId: change.assetId,
      assetTitle: change.assetTitle,
      previousQuantity: slice.quantity,
      quantity: change.quantity,
    });
  }

  const resized = ordered.filter(
    (change, i) => applied[i].previousQuantity !== change.quantity
  );
  // Every changed slice is a quantity-tracked standalone slice; the facade
  // leaves LEGACY ones alone. A booking always has dates; a window-less
  // scope has no holds to keep in step.
  if (window && resized.length > 0) {
    await resizeSlices(tx, {
      organizationId,
      bookingId,
      changes: resized.map((c) => ({
        sliceId: c.bookingAssetId,
        quantity: c.quantity,
      })),
      window,
      admit,
    });
  }
  for (const change of resized) {
    await tx.bookingAsset.update({
      where: { id: change.bookingAssetId },
      data: { quantity: change.quantity },
    });
  }
  return applied;
}

/**
 * Sets the booked quantity of several standalone slices inside the caller's
 * transaction, so they commit or roll back with whatever else it writes.
 *
 * Locks the booking row first (a no-op when the caller already holds it in
 * this transaction), then the assets in id order. See
 * {@link applyChangesUnderBookingLock}.
 *
 * @param tx - The caller's interactive transaction
 * @param args.changes - The slices to change, with their new amounts
 * @returns what each change did; unchanged slices report equal quantities
 * @throws {ShelfError} 404 when the booking or a slice vanished, 400 when a
 *   checked-out slice may not change, when the sources refuse the change, or
 *   the availability guard's own error when an increase exceeds what the
 *   window has free
 */
export async function setStandaloneBookedQuantitiesWithinTx(
  tx: BookedQuantityTx,
  args: BookingScope & { changes: BookedQuantityChange[] }
): Promise<AppliedBookedQuantityChange[]> {
  if (args.changes.length === 0) return [];
  const bookingStatus = await lockBookingForStatusCheck(
    tx,
    args.bookingId,
    args.organizationId
  );
  return applyChangesUnderBookingLock(tx, { ...args, bookingStatus });
}

/**
 * Sets the booked quantity of several standalone slices in ONE transaction of
 * their own: either every change lands or none does. See
 * {@link setStandaloneBookedQuantitiesWithinTx} for the guards.
 *
 * @returns what each change did; an empty set opens no transaction
 */
export async function setStandaloneBookedQuantities(
  args: BookingScope & { changes: BookedQuantityChange[] }
): Promise<AppliedBookedQuantityChange[]> {
  if (args.changes.length === 0) return [];
  return db.$transaction((tx) =>
    setStandaloneBookedQuantitiesWithinTx(tx, args)
  );
}

/** Who asks for a sources change, and what they ask for. */
export type SourcesRequest = {
  /** The parsed `sources` payload of the adjust action. */
  input: BookingSourcesInput;
  /** The acting user, named in the note and the event. */
  userId: string;
};

/** A source as the event stores it. */
type SourceSnapshot = {
  kind: BookingSourcePart["kind"];
  locationId: string | null;
  planned: number;
};

/** The parts of a slice, for the note and the event. */
async function describeSliceSources(
  tx: Pick<BookedQuantityTx, "bookingAssetSource" | "location">,
  organizationId: string,
  bookingAssetId: string
): Promise<BookingSourcePart[]> {
  const rows = await readSliceSourceRows(tx, organizationId, bookingAssetId);
  const locationIds = [
    ...new Set(rows.flatMap((r) => (r.locationId ? [r.locationId] : []))),
  ];
  const locations =
    locationIds.length === 0
      ? []
      : await tx.location.findMany({
          where: { id: { in: locationIds }, organizationId },
          select: { id: true, name: true },
        });
  return describeBookingSources({
    rows,
    locationNames: new Map(locations.map((l) => [l.id, l.name])),
    shortSourceKeys: new Set(),
  });
}

/** The event's view of the parts. */
function snapshotOf(parts: BookingSourcePart[]): SourceSnapshot[] {
  return parts.map((p) => ({
    kind: p.kind,
    locationId: p.locationId,
    planned: p.planned,
  }));
}

/**
 * The note's list of sources: "Demo Warehouse 8, Unplaced 7". Location names
 * are user text, so Markdoc delimiters are stripped.
 */
export function formatSourcesForNote(parts: BookingSourcePart[]): string {
  if (parts.length === 0) return "none";
  return parts
    .map((p) => `${stripMarkdocDelimiters(p.label)} ${p.planned}`)
    .join(", ");
}

/** A slice's sources and mode at one moment, for the note and the event. */
export type SourcesState = {
  mode: BookingSourceAllocation | undefined;
  parts: BookingSourcePart[];
};

/** Reads a slice's mode and display parts. */
async function readSourcesState(
  tx: BookedQuantityTx,
  organizationId: string,
  sliceId: string
): Promise<SourcesState> {
  const slice = await tx.bookingAsset.findUnique({
    where: { id: sliceId },
    select: { sourceAllocation: true },
  });
  return {
    mode: slice?.sourceAllocation,
    parts: await describeSliceSources(tx, organizationId, sliceId),
  };
}

/**
 * True when where the units come from changed between two states: the mode
 * changed, or units moved between sources. A quantity change on its own is
 * not a move: when every source only grows (the quantity went up) or only
 * shrinks (it went down), no unit moved. A unit moved when the units gained
 * at sources exceed the growth of the total planned units.
 */
export function sourcesMoved(
  before: SourcesState,
  after: SourcesState
): boolean {
  if (before.mode !== after.mode) return true;
  const plannedBefore = new Map(before.parts.map((p) => [p.key, p.planned]));
  const plannedAfter = new Map(after.parts.map((p) => [p.key, p.planned]));
  const keys = new Set([...plannedBefore.keys(), ...plannedAfter.keys()]);
  let gained = 0;
  for (const key of keys) {
    gained += Math.max(
      0,
      (plannedAfter.get(key) ?? 0) - (plannedBefore.get(key) ?? 0)
    );
  }
  const total = (parts: BookingSourcePart[]) =>
    parts.reduce((sum, p) => sum + p.planned, 0);
  const growth = Math.max(0, total(after.parts) - total(before.parts));
  return gained > growth;
}

/**
 * Sets where a slice's units come from, inside the caller's transaction,
 * under the booking lock: MANUAL by hand, or AUTO by the allocation rule.
 * When the final state differs from `before` (see {@link sourcesMoved}),
 * writes a booking note and a `BOOKING_ASSET_SOURCES_CHANGED` event in the
 * same transaction.
 *
 * @param args.before - The slice's state read before any change of this
 *   request (quantity included), so the event never records an
 *   intermediate state
 * @returns True when a note and an event were written
 * @throws {ShelfError} 400 on a booking without dates, or any refusal of the
 *   facade (a location that is not a placement of the asset, a split that
 *   does not add up, units that do not fit)
 */
async function applySourcesUnderBookingLock(
  tx: BookedQuantityTx,
  args: {
    organizationId: string;
    bookingId: string;
    window: BookingScope["window"];
    change: BookedQuantityChange;
    sources: SourcesRequest;
    before: SourcesState;
  }
): Promise<boolean> {
  const { organizationId, bookingId, window, change, sources, before } = args;
  if (!window) {
    throw userError(
      "Sources not changed",
      "Sources can be chosen only for a booking with dates.",
      { bookingId }
    );
  }
  const sliceId = change.bookingAssetId;
  if (sources.input.mode === "MANUAL") {
    await setManualSources(tx, {
      organizationId,
      bookingId,
      sliceId,
      sources: sources.input.sources,
      window,
    });
  } else {
    await setAutoSources(tx, { organizationId, bookingId, sliceId, window });
  }
  const after = await readSourcesState(tx, organizationId, sliceId);
  if (!sourcesMoved(before, after)) return false;

  const actorUser = await getUserByID(sources.userId, {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      displayName: true,
    } satisfies Prisma.UserSelect,
  });
  const actor = wrapUserLinkForNote({ ...actorUser, id: sources.userId });
  const assetLink = wrapLinkForNote(
    `/assets/${change.assetId}`,
    stripMarkdocDelimiters(change.assetTitle)
  );
  const how = after.mode === "AUTO" ? " (chosen automatically)" : "";
  await createSystemBookingNote(
    {
      bookingId,
      organizationId,
      content: `${actor} changed where units come from for ${assetLink}: ${formatSourcesForNote(
        after.parts
      )}${how}.`,
    },
    tx
  );
  await recordEvent(
    {
      organizationId,
      actorUserId: sources.userId,
      action: "BOOKING_ASSET_SOURCES_CHANGED",
      entityType: "BOOKING",
      entityId: bookingId,
      bookingId,
      assetId: change.assetId,
      field: "sources",
      fromValue: snapshotOf(before.parts),
      toValue: snapshotOf(after.parts),
      meta: { sliceId, mode: after.mode ?? null },
    },
    tx
  );
  return true;
}

/**
 * Sets the booked quantity of one standalone slice and, when asked, where
 * its units come from, in one transaction. The quantity changes first (see
 * {@link setStandaloneBookedQuantitiesWithinTx} for the guards); a MANUAL
 * split must then add up to the slice's planned units after the change.
 * With sources, the resize admits nothing on its own: the new quantity is
 * admitted once, with the new split (MANUAL) or the re-allocation (AUTO).
 *
 * The status rule is the manage-items one (`canManageBookingItems`),
 * checked against the LOCKED status so every entry point (web and mobile)
 * shares it: COMPLETE, CANCELLED and ARCHIVED bookings refuse every change,
 * and callers held to DRAFT may only change a DRAFT booking.
 *
 * @param args.access - The caller's role access
 * @param args.sources - Optional sources change
 * @returns the quantity the slice held before the change, read under the
 *   lock, and whether the sources changed
 * @throws {ShelfError} 403 when the booking's status does not allow the
 *   caller to change its items; 400 when the sources cannot be changed (see
 *   {@link applySourcesUnderBookingLock}); otherwise as the quantity guards
 */
export async function setStandaloneBookedQuantity({
  bookingId,
  organizationId,
  window,
  sources,
  access,
  ...change
}: BookingScope &
  BookedQuantityChange & {
    sources?: SourcesRequest;
    access: RoleAccess;
  }): Promise<{
  previousQuantity: number;
  sourcesChanged: boolean;
}> {
  return db.$transaction(async (tx) => {
    const bookingStatus = await lockBookingForStatusCheck(
      tx,
      bookingId,
      organizationId
    );
    assertCanChangeBookedQuantity({ access, bookingId, bookingStatus });
    // Read before the quantity changes, so the event compares committed
    // states only.
    const before = sources
      ? await readSourcesState(tx, organizationId, change.bookingAssetId)
      : null;
    const [applied] = await applyChangesUnderBookingLock(tx, {
      bookingId,
      organizationId,
      window,
      changes: [change],
      bookingStatus,
      // The sources call below admits the new quantity with the new split.
      admit: !sources,
    });
    const sourcesChanged =
      sources && before
        ? await applySourcesUnderBookingLock(tx, {
            organizationId,
            bookingId,
            window,
            change,
            sources,
            before,
          })
        : false;
    return { previousQuantity: applied.previousQuantity, sourcesChanged };
  });
}

/**
 * The manage-items status rule for a booked-quantity change.
 *
 * @throws {ShelfError} 403 when the caller may not change this booking's
 *   items in its current status
 */
function assertCanChangeBookedQuantity({
  access,
  bookingId,
  bookingStatus,
}: {
  access: RoleAccess;
  bookingId: string;
  bookingStatus: BookingStatus;
}): void {
  if (canManageBookingItems({ access, bookingStatus })) return;
  throw new ShelfError({
    cause: null,
    title: "Action not allowed",
    message:
      "Quantities cannot be changed on this booking in its current status.",
    additionalData: { bookingId, status: bookingStatus },
    label: "Booking",
    status: 403,
    shouldBeCaptured: false,
  });
}

/**
 * Activity notes for booked-quantity changes, on each asset's feed and on the
 * booking's feed. Best-effort: the quantities are already committed, so a
 * failure here is logged, never thrown. Unchanged entries are skipped, and
 * the actor is looked up once for the whole set.
 *
 * @param args.source - `"mobile"` appends "via mobile app" to every note
 */
export async function noteBookedQuantityChanges({
  userId,
  organizationId,
  bookingId,
  bookingName,
  changes,
  source,
}: {
  userId: string;
  organizationId: string;
  bookingId: string;
  bookingName: string;
  changes: AppliedBookedQuantityChange[];
  source: "web" | "mobile";
}): Promise<void> {
  const changed = changes.filter((c) => c.previousQuantity !== c.quantity);
  if (changed.length === 0) return;
  const suffix = source === "mobile" ? " via mobile app" : "";
  try {
    const actorUser = await getUserByID(userId, {
      select: {
        id: true,
        firstName: true,
        lastName: true,
        displayName: true,
      } satisfies Prisma.UserSelect,
    });
    const actor = wrapUserLinkForNote({ ...actorUser, id: userId });
    const bookingLink = wrapLinkForNote(`/bookings/${bookingId}`, bookingName);
    await Promise.all(
      changed.flatMap((change) => [
        createNotes({
          content: `${actor} adjusted booked quantity for ${bookingLink} from **${change.previousQuantity}** to **${change.quantity}**${suffix}.`,
          type: "UPDATE",
          userId,
          assetIds: [change.assetId],
          organizationId,
        }),
        createSystemBookingNote({
          bookingId,
          organizationId,
          content: `${actor} adjusted booked quantity for ${wrapLinkForNote(
            `/assets/${change.assetId}`,
            stripMarkdocDelimiters(change.assetTitle)
          )} from **${change.previousQuantity}** to **${
            change.quantity
          }**${suffix}.`,
        }),
      ])
    );
  } catch (noteError) {
    Logger.error(
      makeShelfError(noteError, {
        userId,
        bookingId,
        assetIds: changed.map((c) => c.assetId),
        context: "booked-quantity note creation",
      })
    );
  }
}
