import type { Prisma } from "@prisma/client";
import { db } from "~/database/db.server";
import { assertAssetQuantityAvailable } from "~/modules/asset/availability.server";
import { createSystemBookingNote } from "~/modules/booking-note/service.server";
import { lockAssetForQuantityUpdate } from "~/modules/consumption-log/quantity-lock.server";
import { createNotes } from "~/modules/note/service.server";
import { getUserByID } from "~/modules/user/service.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import { stripMarkdocDelimiters } from "~/utils/markdoc-sanitize";
import { wrapLinkForNote, wrapUserLinkForNote } from "~/utils/markdoc-wrappers";

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
 *   amount: lowering it would strand units that can no longer be checked in,
 *   and raising it would count units as out that never left.
 * - The asset row is locked for the read-then-write, and the slice is re-read
 *   under that lock, so two concurrent edits cannot both pass the guard.
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

/** The slice's current amount and whether its units have gone out. */
type SliceState = { quantity: number; checkedOutAt: Date | null };

/**
 * Reads a slice and refuses it when it vanished or its units are out. A
 * request equal to the current amount is a no-op and is never refused.
 *
 * @throws {ShelfError} 404 when the slice is gone, 400 when it is checked out
 */
async function readChangeableSlice(
  // The plain client for the pre-check, or the interactive transaction.
  client: Pick<typeof db, "bookingAsset">,
  change: BookedQuantityChange
): Promise<SliceState> {
  const slice = await client.bookingAsset.findUnique({
    where: { id: change.bookingAssetId },
    select: { quantity: true, checkedOutAt: true },
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
    throw new ShelfError({
      cause: null,
      title: "Already checked out",
      message: `Units of "${change.assetTitle}" have already been checked out on this booking, so its booked quantity can no longer change.`,
      additionalData: { bookingAssetId: change.bookingAssetId },
      label: "Booking",
      status: 400,
      shouldBeCaptured: false,
    });
  }
  return slice;
}

/**
 * Checks a set of changes without locking or writing anything.
 *
 * Lets a caller that writes something else first (the mobile re-add, which
 * inserts new assets before it resizes held ones) refuse the whole request
 * up front, so a resize that cannot pass never lands after the insert. The
 * locked check in {@link setStandaloneBookedQuantities} still runs; this one
 * only narrows the window in which it can fail.
 *
 * @param args.changes - The slices to check, with their requested amounts
 * @throws {ShelfError} the first refusal: a missing or checked-out slice, or
 *   an increase beyond what the window has free
 */
export async function assertBookedQuantitiesChangeable({
  bookingId,
  organizationId,
  window,
  changes,
}: BookingScope & { changes: BookedQuantityChange[] }): Promise<void> {
  for (const change of changes) {
    const slice = await readChangeableSlice(db, change);
    await assertAssetQuantityAvailable({
      assetId: change.assetId,
      organizationId,
      tx: db,
      window,
      excludeBookingId: bookingId,
      currentQuantity: slice.quantity,
      requestedQuantity: change.quantity,
      assetTitle: change.assetTitle,
      unitOfMeasure: change.unitOfMeasure,
    });
  }
}

/**
 * Sets the booked quantity of several standalone slices in ONE transaction:
 * either every change lands or none does.
 *
 * Asset rows are locked in id order, so two requests touching the same assets
 * cannot deadlock. Each slice is re-read under its lock; a stale-high
 * snapshot would otherwise let an increase pass the directional guard as a
 * reduction.
 *
 * @param args.changes - The slices to change, with their new amounts
 * @returns what each change did; unchanged slices report equal quantities
 * @throws {ShelfError} 404 when a slice vanished, 400 when one is checked out,
 *   or the availability guard's own error when an increase exceeds what the
 *   window has free
 */
export async function setStandaloneBookedQuantities({
  bookingId,
  organizationId,
  window,
  changes,
}: BookingScope & {
  changes: BookedQuantityChange[];
}): Promise<AppliedBookedQuantityChange[]> {
  if (changes.length === 0) return [];
  const ordered = [...changes].sort((a, b) =>
    a.assetId.localeCompare(b.assetId)
  );

  return db.$transaction(async (tx) => {
    const applied: AppliedBookedQuantityChange[] = [];
    for (const change of ordered) {
      await lockAssetForQuantityUpdate(tx, change.assetId, organizationId);
      const slice = await readChangeableSlice(tx, change);

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

      if (slice.quantity !== change.quantity) {
        await tx.bookingAsset.update({
          where: { id: change.bookingAssetId },
          data: { quantity: change.quantity },
        });
      }

      applied.push({
        assetId: change.assetId,
        assetTitle: change.assetTitle,
        previousQuantity: slice.quantity,
        quantity: change.quantity,
      });
    }
    return applied;
  });
}

/**
 * Sets the booked quantity of one standalone slice. See
 * {@link setStandaloneBookedQuantities} for the guards.
 *
 * @returns the quantity the slice held before the change, read under the lock
 */
export async function setStandaloneBookedQuantity({
  bookingId,
  organizationId,
  window,
  ...change
}: BookingScope & BookedQuantityChange): Promise<{
  previousQuantity: number;
}> {
  const [applied] = await setStandaloneBookedQuantities({
    bookingId,
    organizationId,
    window,
    changes: [change],
  });
  return { previousQuantity: applied.previousQuantity };
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
          content: `${actor} adjusted booked quantity for **${stripMarkdocDelimiters(
            change.assetTitle
          )}** from **${change.previousQuantity}** to **${
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
