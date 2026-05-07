/**
 * API Route: Booking Model Requests (Phase 3d — Book-by-Model)
 *
 * Upsert / remove a `BookingModelRequest` row — the intent to reserve
 * N units of an `AssetModel` without picking specific assets upfront.
 * Concrete `BookingAsset` rows are only created at scan-to-assign
 * time; this route only manipulates the intent.
 *
 * - `POST`   — upsert a request `{ assetModelId, quantity }` (qty ≥ 1)
 * - `DELETE` — remove a request `{ assetModelId }`
 *
 * The shape mirrors
 * {@link file://./bookings.$bookingId.adjust-asset-quantity.ts} for
 * consistency with the Phase 3b quantity-adjust endpoint: same
 * permission guard, same error-handling wrapper, same `data(payload)`
 * success envelope.
 *
 * @see {@link file://./../../modules/booking-model-request/service.server.ts}
 */

import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import {
  removeBookingModelRequest,
  upsertBookingModelRequest,
} from "~/modules/booking-model-request/service.server";
import { validateBookingOwnership } from "~/utils/booking-authorization.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, notAllowedMethod, ShelfError } from "~/utils/error";
import {
  error,
  getParams,
  isDelete,
  isPost,
  parseData,
  payload,
} from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

/**
 * POST body schema — target quantity for a `(booking, assetModel)` pair.
 * Exported so callers (UI forms, tests) can reuse the same validation.
 */
export const UpsertModelRequestSchema = z.object({
  assetModelId: z.string().min(1, "Asset model ID is required"),
  quantity: z.coerce
    .number()
    .int()
    .positive("Quantity must be a positive integer"),
});

/**
 * DELETE body schema — identifies which model-level reservation to
 * cancel on the booking.
 */
export const DeleteModelRequestSchema = z.object({
  assetModelId: z.string().min(1, "Asset model ID is required"),
});

export async function action({ context, request, params }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const userId = authSession.userId;
  const { bookingId } = getParams(params, z.object({ bookingId: z.string() }), {
    additionalData: { userId },
  });

  try {
    /**
     * Both verbs share the same permission guard — only users who can
     * UPDATE a booking may edit its model-level reservations. The
     * service layer enforces the additional constraint that only
     * DRAFT / RESERVED bookings accept edits.
     */
    const { organizationId, role, isSelfServiceOrBase } =
      await requirePermission({
        request,
        userId,
        entity: PermissionEntity.booking,
        action: PermissionAction.update,
      });

    /**
     * `booking:update` is granted to SELF_SERVICE / BASE roles in
     * `Role2PermissionMap`, so the permission check alone lets any user
     * in the org reach this endpoint for any bookingId. Without an
     * additional ownership check those roles could manipulate other
     * users' model reservations (cross-user IDOR within the org).
     *
     * Mirrors the guard pattern used on the page-level booking routes
     * (see `bookings.$bookingId.overview.tsx` and the calendar export).
     */
    if (isSelfServiceOrBase) {
      const booking = await db.booking.findFirst({
        where: { id: bookingId, organizationId },
        select: { creatorId: true, custodianUserId: true },
      });

      if (!booking) {
        throw new ShelfError({
          cause: null,
          title: "Not found",
          message: "Booking not found.",
          label: "Booking",
          status: 404,
          shouldBeCaptured: false,
        });
      }

      validateBookingOwnership({
        booking,
        userId,
        role,
        action: "manage model reservations on",
      });
    }

    const formData = await request.formData();

    if (isPost(request)) {
      const { assetModelId, quantity } = parseData(
        formData,
        UpsertModelRequestSchema
      );

      const modelRequest = await upsertBookingModelRequest({
        bookingId,
        assetModelId,
        quantity,
        organizationId,
        userId,
      });

      sendNotification({
        title: "Model reservation saved",
        message: `Reserved ${quantity} unit${
          quantity === 1 ? "" : "s"
        } of this model on the booking.`,
        icon: { name: "success", variant: "success" },
        senderId: userId,
      });

      return data(payload({ success: true, request: modelRequest }));
    }

    if (isDelete(request)) {
      const { assetModelId } = parseData(formData, DeleteModelRequestSchema);

      await removeBookingModelRequest({
        bookingId,
        assetModelId,
        organizationId,
        userId,
      });

      sendNotification({
        title: "Model reservation cancelled",
        message: "The model-level reservation was removed from the booking.",
        icon: { name: "success", variant: "success" },
        senderId: userId,
      });

      return data(payload({ success: true }));
    }

    /**
     * Only POST / DELETE are supported. Anything else (GET, PUT, PATCH)
     * returns a 405 so callers get a consistent error envelope — same
     * as the `assertIsPost` path in the single-verb routes.
     */
    throw notAllowedMethod("POST, DELETE");
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, bookingId });
    return data(error(reason), { status: reason.status });
  }
}
