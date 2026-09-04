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
 * Changing how many units of a quantity-tracked asset a booking holds, on its
 * STANDALONE slice (`assetKitId IS NULL`). Shared by the mobile
 * adjust-asset-quantity route and the mobile add-scanned-assets route (which
 * treats "add an asset that is already on the booking, with a quantity" as
 * this change rather than as a duplicate insert).
 *
 * The rule is the web "Adjust quantity" dialog's: a reduction always passes,
 * even when the pool is already over-committed by other bookings; only an
 * increase is measured against what is free in the booking's own `[from, to]`
 * window with this booking excluded. The asset row is locked for the
 * read-then-write so two concurrent edits cannot both pass the guard.
 *
 * @see {@link file://../../routes/api+/bookings.$bookingId.adjust-asset-quantity.ts} the web twin
 */

export type SetStandaloneBookedQuantityArgs = {
  /** The standalone `BookingAsset` row to change. */
  bookingAssetId: string;
  assetId: string;
  bookingId: string;
  organizationId: string;
  /** The booking's own window, or null for a dateless booking. */
  window: { from: Date; to: Date } | null;
  /** The new booked quantity (a positive integer). */
  quantity: number;
  assetTitle: string;
  unitOfMeasure: string | null;
};

/**
 * Sets the booked quantity of one standalone slice inside its own
 * transaction, guarded and locked as described above.
 *
 * @returns the quantity the slice held before the change, read under the lock
 * @throws {ShelfError} 404 when the slice vanished, or the availability
 *   guard's own error when an increase exceeds what the window has free
 */
export async function setStandaloneBookedQuantity({
  bookingAssetId,
  assetId,
  bookingId,
  organizationId,
  window,
  quantity,
  assetTitle,
  unitOfMeasure,
}: SetStandaloneBookedQuantityArgs): Promise<{ previousQuantity: number }> {
  return db.$transaction(async (tx) => {
    await lockAssetForQuantityUpdate(tx, assetId, organizationId);

    // Re-read under the lock: the directional guard treats a request at or
    // below the CURRENT quantity as a reduction and skips the availability
    // check, so a stale-high snapshot would let an increase slip past it.
    const fresh = await tx.bookingAsset.findUnique({
      where: { id: bookingAssetId },
      select: { quantity: true },
    });
    if (!fresh) {
      throw new ShelfError({
        cause: null,
        title: "Not found",
        message: "This asset is not part of the booking.",
        label: "Booking",
        status: 404,
        shouldBeCaptured: false,
      });
    }
    const currentQuantity = fresh.quantity;

    await assertAssetQuantityAvailable({
      assetId,
      organizationId,
      tx,
      window,
      excludeBookingId: bookingId,
      currentQuantity,
      requestedQuantity: quantity,
      assetTitle,
      unitOfMeasure,
    });

    if (currentQuantity !== quantity) {
      await tx.bookingAsset.update({
        where: { id: bookingAssetId },
        data: { quantity },
      });
    }

    return { previousQuantity: currentQuantity };
  });
}

/**
 * Activity notes for a booked-quantity change, on both the asset feed and
 * the booking feed. Best-effort: the quantity is already committed, so a
 * failure here is logged, never thrown. Skips a no-op change.
 */
export async function noteBookedQuantityChange({
  userId,
  organizationId,
  bookingId,
  bookingName,
  assetId,
  assetTitle,
  previousQuantity,
  quantity,
}: {
  userId: string;
  organizationId: string;
  bookingId: string;
  bookingName: string;
  assetId: string;
  assetTitle: string;
  previousQuantity: number;
  quantity: number;
}): Promise<void> {
  if (previousQuantity === quantity) return;
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
    await Promise.all([
      createNotes({
        content: `${actor} adjusted booked quantity for ${bookingLink} from **${previousQuantity}** to **${quantity}** via mobile app.`,
        type: "UPDATE",
        userId,
        assetIds: [assetId],
        organizationId,
      }),
      createSystemBookingNote({
        bookingId,
        organizationId,
        content: `${actor} adjusted booked quantity for **${stripMarkdocDelimiters(
          assetTitle
        )}** from **${previousQuantity}** to **${quantity}** via mobile app.`,
      }),
    ]);
  } catch (noteError) {
    Logger.error(
      makeShelfError(noteError, {
        userId,
        bookingId,
        assetId,
        context: "mobile booked-quantity note creation",
      })
    );
  }
}
