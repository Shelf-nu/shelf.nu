/**
 * API Route: Adjust Booking Asset Quantity
 *
 * Updates the booked quantity of a single QUANTITY_TRACKED asset inside
 * a booking. Validates the new quantity via the shared directional,
 * windowed availability guard (`assertAssetQuantityAvailable`) before
 * applying it — a reduction always passes (even if the pool is already
 * over-committed by other bookings, #2725); only an increase is measured
 * against windowed availability over the booking's own `[from, to]`.
 *
 * @see {@link file://./../../components/booking/adjust-booking-asset-quantity-dialog.tsx}
 * @see {@link file://./../../modules/asset/availability.server.ts}
 */

import type { Prisma } from "@prisma/client";
import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import { assertAssetQuantityAvailable } from "~/modules/asset/availability.server";
import { isQuantityTracked } from "~/modules/asset/utils";
import { createSystemBookingNote } from "~/modules/booking-note/service.server";
import { lockAssetForQuantityUpdate } from "~/modules/consumption-log/quantity-lock.server";
import { createNotes } from "~/modules/note/service.server";
import { getUserByID } from "~/modules/user/service.server";
import { validateBookingOwnership } from "~/utils/booking-authorization.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import {
  assertIsPost,
  payload,
  error,
  getParams,
  parseData,
} from "~/utils/http.server";
import { Logger } from "~/utils/logger";
import { wrapLinkForNote, wrapUserLinkForNote } from "~/utils/markdoc-wrappers";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export const AdjustBookingAssetQuantitySchema = z.object({
  assetId: z.string().min(1, "Asset ID is required"),
  quantity: z.coerce
    .number()
    .int()
    .positive("Quantity must be a positive integer"),
});

export async function action({ context, request, params }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const userId = authSession.userId;
  const { bookingId } = getParams(params, z.object({ bookingId: z.string() }), {
    additionalData: { userId },
  });

  try {
    assertIsPost(request);

    const { organizationId, role, isSelfServiceOrBase } =
      await requirePermission({
        request,
        userId,
        entity: PermissionEntity.booking,
        action: PermissionAction.update,
      });

    const formData = await request.formData();
    const { assetId, quantity } = parseData(
      formData,
      AdjustBookingAssetQuantitySchema
    );

    /**
     * Verify the booking belongs to the organization and the asset is part
     * of it. We also pull the booking's id+name so we can produce a linkable
     * booking reference in activity notes, plus `creatorId`/`custodianUserId`
     * for the SELF_SERVICE/BASE ownership check below.
     */
    // Scope to the STANDALONE slice (`assetKitId IS NULL`). A qty-tracked
    // asset booked via the kit picker has a separate kit-driven row whose
    // quantity is managed by the kit (live link from `updateKitAssets`);
    // adjusting it from this surface would silently desync the kit. Users
    // adjust the standalone slice here; kit slice edits go through the
    // kit picker.
    const bookingAsset = await db.bookingAsset.findFirst({
      where: {
        bookingId,
        assetId,
        assetKitId: null,
        booking: { organizationId },
      },
      include: {
        asset: {
          select: { id: true, title: true, type: true, unitOfMeasure: true },
        },
        booking: {
          select: {
            id: true,
            name: true,
            creatorId: true,
            custodianUserId: true,
            from: true,
            to: true,
          },
        },
      },
    });

    if (!bookingAsset) {
      throw new ShelfError({
        cause: null,
        title: "Not found",
        message: "This asset is not part of the booking.",
        label: "Booking",
        status: 404,
        shouldBeCaptured: false,
      });
    }

    /**
     * `booking:update` is granted to SELF_SERVICE / BASE roles in
     * `Role2PermissionMap`. Without this guard those roles can hit any
     * `bookingId` in the org and inflate or shrink the booked quantity
     * of another user's reservation (cross-user IDOR within the org).
     */
    if (isSelfServiceOrBase) {
      validateBookingOwnership({
        booking: {
          creatorId: bookingAsset.booking.creatorId,
          custodianUserId: bookingAsset.booking.custodianUserId,
        },
        userId,
        role,
        action: "adjust asset quantity on",
      });
    }

    /** Only QUANTITY_TRACKED assets can have their booked quantity adjusted */
    if (!isQuantityTracked(bookingAsset.asset)) {
      throw new ShelfError({
        cause: null,
        title: "Action not allowed",
        message:
          "Only quantity-tracked assets can have their quantity adjusted.",
        label: "Booking",
        status: 400,
        shouldBeCaptured: false,
      });
    }

    /**
     * Capture the previous quantity before updating so the activity note
     * can show the "from X → to Y" delta. If the quantity didn't actually
     * change we skip the note write below.
     *
     * Seeded from the outside-tx snapshot, but overwritten inside the tx with
     * the value re-read UNDER the lock (see below) so the note reflects the
     * real pre-edit quantity even if a concurrent request changed it.
     *
     * Declared outside the transaction so the activity-notes block (which
     * intentionally lives outside the tx) can reference it.
     */
    let previousQuantity = bookingAsset.quantity;

    /**
     * Validate availability and persist the new quantity atomically.
     *
     * We lock the asset row with `SELECT ... FOR UPDATE` before reading
     * availability so two concurrent adjust requests against the same
     * qty-tracked asset (even from different bookings) are serialized.
     * Without the lock, both callers can read the same stale availability
     * snapshot, each pass their own guard, and both commit — oversubscribing
     * the pool.
     *
     * `assertAssetQuantityAvailable` is the shared directional, windowed
     * guard (see `~/modules/asset/availability.server`). It runs inside
     * this transaction (behind the row lock above) so the read-then-decide
     * is race-safe. Critically, it is *directional*: a submission that is
     * `≤` the row's current quantity is always a reduction and always
     * passes, even when the pool is already over-committed by other
     * bookings — otherwise a booking that became over-reserved (e.g. the
     * asset's total quantity was lowered elsewhere) could never be edited
     * back down (#2725). Only the *increase* portion of a submission is
     * measured against windowed availability, using the booking's own
     * `[from, to]` so non-overlapping reservations don't compete.
     *
     * Exclude the current booking so its existing reservation isn't
     * double-counted.
     */
    await db.$transaction(async (tx) => {
      await lockAssetForQuantityUpdate(tx, assetId, organizationId);

      /**
       * TOCTOU guard: re-read this slice's booked quantity UNDER the asset
       * lock. `bookingAsset.quantity` was read outside the tx (for the
       * ownership/type/permission checks above, which don't race meaningfully),
       * but it may be stale by now. The directional rule in
       * `assertAssetQuantityAvailable` treats `requested <= currentQuantity` as
       * an always-allowed reduction that SKIPS the availability check — so a
       * stale-HIGH `currentQuantity` (a concurrent request already lowered the
       * real booked qty) would let a genuine INCREASE masquerade as a reduction
       * and bypass the guard, oversubscribing the pool. The asset `FOR UPDATE`
       * lock serializes concurrent adjusts on this asset, so this re-read
       * observes the committed value.
       */
      const freshBookingAsset = await tx.bookingAsset.findUnique({
        where: { id: bookingAsset.id },
        select: { quantity: true },
      });

      // The slice vanished between the outside-tx read and here (concurrent
      // removal) — treat it as not-found, consistent with the check above.
      if (!freshBookingAsset) {
        throw new ShelfError({
          cause: null,
          title: "Not found",
          message: "This asset is not part of the booking.",
          label: "Booking",
          status: 404,
          shouldBeCaptured: false,
        });
      }

      const currentQuantity = freshBookingAsset.quantity;

      await assertAssetQuantityAvailable({
        assetId,
        organizationId,
        tx,
        window:
          bookingAsset.booking.from && bookingAsset.booking.to
            ? { from: bookingAsset.booking.from, to: bookingAsset.booking.to }
            : null,
        excludeBookingId: bookingId,
        currentQuantity,
        requestedQuantity: quantity,
        assetTitle: bookingAsset.asset.title,
        unitOfMeasure: bookingAsset.asset.unitOfMeasure ?? null,
      });

      // Drive the "from X → to Y" activity note off the FRESH value too, so the
      // note reflects the real pre-edit quantity (not the stale snapshot).
      previousQuantity = currentQuantity;

      await tx.bookingAsset.update({
        where: { id: bookingAsset.id },
        data: { quantity },
      });
    });

    /**
     * Activity logging: mirror the pattern used by other booking mutations
     * (see `removeAssets` in `modules/booking/service.server.ts`). We write
     * two notes so the change shows up on both the asset activity feed and
     * the booking activity feed.
     *
     * Skipped when the quantity didn't change (e.g. user opened the dialog
     * and hit Save without editing) — no-op shouldn't pollute the log.
     *
     * Wrapped in its own try/catch: note creation is best-effort activity
     * logging and must NOT fail the main quantity update. A transient DB
     * hiccup here shouldn't prevent the user's save from completing (which
     * would leave the dialog open with a misleading error).
     */
    if (previousQuantity !== quantity) {
      try {
        const user = await getUserByID(userId, {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
          } satisfies Prisma.UserSelect,
        });

        const actor = wrapUserLinkForNote({
          id: userId,
          firstName: user?.firstName,
          lastName: user?.lastName,
        });
        const bookingLink = wrapLinkForNote(
          `/bookings/${bookingAsset.booking.id}`,
          bookingAsset.booking.name
        );

        await Promise.all([
          createNotes({
            content: `${actor} adjusted booked quantity for ${bookingLink} from **${previousQuantity}** to **${quantity}**.`,
            type: "UPDATE",
            userId,
            assetIds: [assetId],
            organizationId,
          }),
          createSystemBookingNote({
            bookingId,
            organizationId,
            content: `${actor} adjusted booked quantity for **${bookingAsset.asset.title}** from **${previousQuantity}** to **${quantity}**.`,
          }),
        ]);
      } catch (noteError) {
        Logger.error(
          makeShelfError(noteError, {
            userId,
            bookingId,
            assetId,
            context: "adjust-asset-quantity note creation",
          })
        );
      }
    }

    sendNotification({
      title: "Quantity updated",
      message: `Booked quantity for "${bookingAsset.asset.title}" set to ${quantity}.`,
      icon: { name: "success", variant: "success" },
      senderId: userId,
    });

    return data(payload({ success: true }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, bookingId });
    return data(error(reason), { status: reason.status });
  }
}
