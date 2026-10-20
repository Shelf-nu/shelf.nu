/**
 * API Route: Adjust Booking Asset Quantity
 *
 * Updates the booked quantity of a single QUANTITY_TRACKED asset inside
 * a booking, on its standalone slice. The change itself is the shared
 * booked-quantity service: a reduction always passes, an increase is
 * measured against windowed availability over the booking's own
 * `[from, to]`, and a slice whose units are checked out keeps its amount.
 *
 * @see {@link file://./../../components/booking/adjust-booking-asset-quantity-dialog.tsx}
 * @see {@link file://./../../modules/booking/booked-quantity.server.ts}
 */

import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import { isQuantityTracked } from "~/modules/asset/utils";
import {
  noteBookedQuantityChanges,
  setStandaloneBookedQuantity,
} from "~/modules/booking/booked-quantity.server";
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

    const { organizationId, access } = await requirePermission({
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
     * No-op when `access.bookings.writeAll`.
     */
    validateBookingOwnership({
      booking: {
        creatorId: bookingAsset.booking.creatorId,
        custodianUserId: bookingAsset.booking.custodianUserId,
      },
      userId,
      access,
      action: "adjust asset quantity on",
    });

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

    // Locked, re-read and directionally guarded in one transaction, and
    // refused once the slice's units have been checked out. See the module.
    const { previousQuantity } = await setStandaloneBookedQuantity({
      bookingAssetId: bookingAsset.id,
      assetId,
      bookingId,
      organizationId,
      window:
        bookingAsset.booking.from && bookingAsset.booking.to
          ? { from: bookingAsset.booking.from, to: bookingAsset.booking.to }
          : null,
      quantity,
      assetTitle: bookingAsset.asset.title,
      unitOfMeasure: bookingAsset.asset.unitOfMeasure ?? null,
    });

    // Best-effort: a note failure is logged and never fails the saved change.
    await noteBookedQuantityChanges({
      userId,
      organizationId,
      bookingId,
      bookingName: bookingAsset.booking.name,
      changes: [
        {
          assetId,
          assetTitle: bookingAsset.asset.title,
          previousQuantity,
          quantity,
        },
      ],
      source: "web",
    });

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
