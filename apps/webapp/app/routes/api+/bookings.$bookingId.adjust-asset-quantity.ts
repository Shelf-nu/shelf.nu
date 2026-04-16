/**
 * API Route: Adjust Booking Asset Quantity
 *
 * Updates the booked quantity of a single QUANTITY_TRACKED asset inside
 * a booking. Validates availability (Total - InCustody - Reserved excluding
 * this booking) before applying the new quantity.
 *
 * @see {@link file://./../../components/booking/adjust-booking-asset-quantity-dialog.tsx}
 */

import type { Prisma } from "@prisma/client";
import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import { isQuantityTracked } from "~/modules/asset/utils";
import { createSystemBookingNote } from "~/modules/booking-note/service.server";
import { computeBookingAvailableQuantity } from "~/modules/consumption-log/service.server";
import { createNotes } from "~/modules/note/service.server";
import { getUserByID } from "~/modules/user/service.server";
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

    const { organizationId } = await requirePermission({
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
     * booking reference in activity notes.
     */
    const bookingAsset = await db.bookingAsset.findFirst({
      where: {
        bookingId,
        assetId,
        booking: { organizationId },
      },
      include: {
        asset: { select: { id: true, title: true, type: true } },
        booking: { select: { id: true, name: true } },
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
     * Validate the requested quantity doesn't exceed availability.
     * Exclude the current booking so its existing reservation isn't
     * double-counted.
     */
    const availability = await computeBookingAvailableQuantity(
      assetId,
      bookingId
    );

    if (quantity > availability.available) {
      throw new ShelfError({
        cause: null,
        message: `Cannot reserve ${quantity} units of "${bookingAsset.asset.title}". Only ${availability.available} available.`,
        label: "Booking",
        status: 400,
        shouldBeCaptured: false,
      });
    }

    /**
     * Capture the previous quantity before updating so the activity note
     * can show the "from X → to Y" delta. If the quantity didn't actually
     * change we skip the note write below.
     */
    const previousQuantity = bookingAsset.quantity;

    await db.bookingAsset.update({
      where: { id: bookingAsset.id },
      data: { quantity },
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
          }),
          createSystemBookingNote({
            bookingId,
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
