/**
 * One page of the booking Models tab.
 *
 * The Models tab of the manage-assets and manage-kits dialogs gets its first
 * page from the dialog's loader, then loads every other page through this
 * route with a fetcher when the operator searches, pages or switches between
 * "Models with assets" and "All models". Serving those reads here keeps them
 * off the dialog's URL, so they never re-run the dialog's loader and its asset
 * or kit list.
 *
 * Query: `modelSearch`, `modelPage` and `showEmptyModels`, read by
 * `readModelTabParams`. The page is shaped exactly like the dialog loader's
 * model payload: the same options (reserved models pinned first, a stale page
 * clamped to the last one) go to `getBookingModelTabData`.
 *
 * @see {@link file://./../../components/booking/manage-model-requests.tsx}
 * @see {@link file://./bookings.$bookingId.model-requests.ts} The write side
 */

import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import { getBookingModelTabData } from "~/modules/booking-model-request/service.server";
import { validateBookingOwnership } from "~/utils/booking-authorization.server";
import { readModelTabParams } from "~/utils/booking-model-requests";
import { makeShelfError, ShelfError } from "~/utils/error";
import { error, getParams, payload } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

/**
 * Serves one page of the Models tab for a booking.
 *
 * Gated like the reservation writes it feeds (`booking: update`, plus the
 * ownership check for roles that may only write their own bookings), because
 * the page tells the caller what this booking reserves.
 *
 * @param args.context - Carries the auth session
 * @param args.request - Read for the active organization and the query
 * @param args.params - Carries `bookingId`
 * @returns The Models tab payload, see `BookingModelTabData`
 * @throws {Response} 404 when the booking is not in this workspace, 403 when
 *   a restricted caller does not own it
 */
export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const { userId } = context.getSession();
  const { bookingId } = getParams(params, z.object({ bookingId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId, access } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.booking,
      action: PermissionAction.update,
    });

    // Scoped to the workspace: a booking id from another one is a 404.
    const booking = await db.booking.findFirst({
      where: { id: bookingId, organizationId },
      select: {
        id: true,
        from: true,
        to: true,
        creatorId: true,
        custodianUserId: true,
        modelRequests: {
          select: {
            assetModelId: true,
            quantity: true,
            fulfilledQuantity: true,
            fulfilledAt: true,
            assetModel: { select: { name: true } },
          },
        },
      },
    });

    if (!booking) {
      throw new ShelfError({
        cause: null,
        label: "Booking",
        title: "Not found",
        status: 404,
        message: "Booking not found.",
        shouldBeCaptured: false,
      });
    }

    validateBookingOwnership({
      booking,
      userId,
      access,
      action: "manage model reservations on",
    });

    const modelTabData = await getBookingModelTabData({
      organizationId,
      booking,
      ...readModelTabParams(new URL(request.url).searchParams),
      clampPageToResults: true,
      pinReservedModels: true,
    });

    return data(payload(modelTabData));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, bookingId });
    return data(error(reason), { status: reason.status });
  }
}
