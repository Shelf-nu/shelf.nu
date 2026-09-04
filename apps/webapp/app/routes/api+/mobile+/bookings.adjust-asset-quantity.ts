import { OrganizationRoles } from "@prisma/client";
import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
  getMobileUserContext,
  assertMobileCanUseBookings,
} from "~/modules/api/mobile-auth.server";
import { parseMobileBody } from "~/modules/api/mobile-body.server";
import { isQuantityTracked } from "~/modules/asset/utils";
import {
  noteBookedQuantityChange,
  setStandaloneBookedQuantity,
} from "~/modules/booking/booked-quantity.server";
import { validateBookingOwnership } from "~/utils/booking-authorization.server";
import { canUserManageBookingAssets } from "~/utils/bookings";
import { makeShelfError, ShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { enforceUserRateLimit } from "~/utils/rate-limit.server";

/**
 * POST /api/mobile/bookings/adjust-asset-quantity
 *
 * Changes how many units of one quantity-tracked asset a booking holds — the
 * mobile twin of the web "Adjust quantity" dialog
 * (`api+/bookings.$bookingId.adjust-asset-quantity`). Same rules, same guard:
 *
 * - Only the STANDALONE slice (`assetKitId IS NULL`) is editable. A kit-driven
 *   slice takes its quantity from the kit and is adjusted through the kit.
 * - A reduction always passes, even when the pool is already over-committed
 *   by other bookings; only an increase is measured against what is free in
 *   the booking's own `[from, to]` window, with this booking excluded.
 * - The asset row is locked for the read-then-write, so two concurrent edits
 *   cannot both pass the guard and oversubscribe the pool.
 * - COMPLETE / ARCHIVED / CANCELLED bookings reject; SELF_SERVICE and BASE
 *   users may only touch their own DRAFT bookings.
 *
 * Body: { bookingId: string, assetId: string, quantity: number }
 * Response: { success: true, quantity, previousQuantity }
 *
 * @see {@link file://../bookings.$bookingId.adjust-asset-quantity.ts} web twin
 * @see {@link file://../../../modules/booking/booked-quantity.server.ts} the shared change
 * @see {@link file://./bookings.asset-availability.ts} the cap the app shows first
 */

const BodySchema = z.object({
  bookingId: z.string().min(1),
  assetId: z.string().min(1),
  quantity: z.number().int().positive().max(1_000_000),
});

export async function action({ request }: ActionFunctionArgs) {
  let userId: string | undefined;

  try {
    const { user } = await requireMobileAuth(request);
    userId = user.id;
    await enforceUserRateLimit(user.id, "bulk");

    const organizationId = await requireOrganizationAccess(request, user.id);

    await requireMobilePermission({
      userId: user.id,
      organizationId,
      entity: PermissionEntity.booking,
      action: PermissionAction.update,
    });

    await assertMobileCanUseBookings(organizationId);

    const { bookingId, assetId, quantity } = await parseMobileBody(
      BodySchema,
      request,
      "Booking"
    );

    // Org-scoped: the slice must belong to a booking in this workspace, and
    // only the standalone slice is adjustable (see the docblock).
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
            status: true,
            from: true,
            to: true,
            creatorId: true,
            custodianUserId: true,
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

    const { role } = await getMobileUserContext(user.id, organizationId);
    const isSelfServiceOrBase =
      role === OrganizationRoles.SELF_SERVICE ||
      role === OrganizationRoles.BASE;

    // `booking:update` is granted to SELF_SERVICE / BASE; without this they
    // could resize another user's reservation by id (same guard as web).
    if (isSelfServiceOrBase) {
      validateBookingOwnership({
        booking: {
          creatorId: bookingAsset.booking.creatorId,
          custodianUserId: bookingAsset.booking.custodianUserId,
        },
        userId: user.id,
        role,
        action: "adjust asset quantity on",
      });
    }

    if (
      !canUserManageBookingAssets(bookingAsset.booking, isSelfServiceOrBase)
    ) {
      throw new ShelfError({
        cause: null,
        title: "Action not allowed",
        message:
          "Quantities cannot be changed on this booking in its current status.",
        additionalData: {
          userId,
          bookingId,
          status: bookingAsset.booking.status,
        },
        label: "Booking",
        status: 403,
        shouldBeCaptured: false,
      });
    }

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

    await noteBookedQuantityChange({
      userId: user.id,
      organizationId,
      bookingId,
      bookingName: bookingAsset.booking.name,
      assetId,
      assetTitle: bookingAsset.asset.title,
      previousQuantity,
      quantity,
    });

    return data({ success: true, quantity, previousQuantity });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
