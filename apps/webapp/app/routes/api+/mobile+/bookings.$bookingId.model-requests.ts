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
import {
  removeBookingModelRequest,
  upsertBookingModelRequest,
} from "~/modules/booking-model-request/service.server";
import { makeShelfError, notAllowedMethod, ShelfError } from "~/utils/error";
import { getParams, isDelete, isPost } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { enforceUserRateLimit } from "~/utils/rate-limit.server";

/**
 * Booking model-level reservations (Book-by-Model) — mobile twin of the web
 * route `api+/bookings.$bookingId.model-requests.ts`.
 *
 * - `POST`   — reserve/edit N units of an `AssetModel`: `{ assetModelId, quantity }`
 * - `DELETE` — cancel a model-level reservation: `{ assetModelId }`
 *
 * Both verbs wrap the SAME shared services the web route uses
 * (`upsertBookingModelRequest` / `removeBookingModelRequest`), so the
 * availability guard, the "DRAFT/RESERVED only" rule, the
 * can't-shrink-below-fulfilled rule and the activity notes all stay identical.
 *
 * Security stack (mirrors `bookings.add-scanned-assets.ts` — the services do
 * NOT check custodian ownership, so a naive wrapper would be a cross-user
 * IDOR): auth → per-user rate limit → org access → `booking:update`
 * permission → TEAM-tier gate → org-scoped booking lookup → SELF_SERVICE/BASE
 * may only touch a booking they own.
 *
 * @see {@link file://../bookings.$bookingId.model-requests.ts} web twin
 * @see {@link file://../../../modules/booking-model-request/service.server.ts} shared services
 */

/**
 * POST body — target quantity for a `(booking, assetModel)` pair. Quantity is
 * the ABSOLUTE reserved total (not a delta); the service upserts to it.
 */
const UpsertSchema = z.object({
  assetModelId: z.string().min(1, "Asset model ID is required"),
  quantity: z.coerce
    .number()
    .int()
    .positive("Quantity must be a positive integer"),
});

/** DELETE body — which model reservation to cancel. */
const DeleteSchema = z.object({
  assetModelId: z.string().min(1, "Asset model ID is required"),
});

/**
 * Validate `body` against `schema`, throwing a 400 `ShelfError` (not the raw
 * `ZodError`, which `makeShelfError` maps to a 500) on failure. Mirrors what
 * `parseData` does for form/query input, for a JSON body.
 */
function parseOr400<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ShelfError({
      cause: parsed.error,
      message: parsed.error.issues[0]?.message ?? "Invalid request body.",
      label: "Booking",
      status: 400,
      shouldBeCaptured: false,
    });
  }
  return parsed.data;
}

export async function action({ request, params }: ActionFunctionArgs) {
  let userId: string | undefined;

  try {
    const { user } = await requireMobileAuth(request);
    userId = user.id;
    // Per-user rate limit — model edits touch the same availability
    // computation as bulk asset adds; bucket them together.
    await enforceUserRateLimit(user.id, "bulk");

    const organizationId = await requireOrganizationAccess(request, user.id);

    // Only users who can UPDATE a booking may edit its model reservations —
    // same gate the web route enforces via requirePermission.
    await requireMobilePermission({
      userId: user.id,
      organizationId,
      entity: PermissionEntity.booking,
      action: PermissionAction.update,
    });

    // Bookings are a TEAM-tier (premium) feature. Gate like every other
    // booking mutation so a PERSONAL workspace can't reserve models via mobile.
    await assertMobileCanUseBookings(organizationId);

    const { bookingId } = getParams(
      params,
      z.object({ bookingId: z.string().min(1) }),
      { additionalData: { userId } }
    );

    // Org-scoped booking lookup — a foreign-org booking id 404s here.
    const booking = await db.booking.findFirst({
      where: { id: bookingId, organizationId },
      select: { id: true, custodianUserId: true },
    });

    if (!booking) {
      return data(
        { error: { message: "Booking not found in this workspace." } },
        { status: 404 }
      );
    }

    const { role } = await getMobileUserContext(user.id, organizationId);
    // BASE is as restricted as SELF_SERVICE here (own bookings only). Keying
    // only on SELF_SERVICE would let a BASE user edit anyone's reservations.
    const isSelfServiceOrBase =
      role === OrganizationRoles.SELF_SERVICE ||
      role === OrganizationRoles.BASE;

    // The `booking:update` permission is granted to SELF_SERVICE / BASE, so
    // the permission check alone lets any user in the org reach any bookingId.
    // Without this ownership check those roles could manipulate other users'
    // model reservations (cross-user IDOR within the org) — the shared
    // service does not scope by custodian.
    if (isSelfServiceOrBase && booking.custodianUserId !== user.id) {
      throw new ShelfError({
        cause: null,
        message: "You can only modify your own bookings.",
        label: "Booking",
        status: 403,
        shouldBeCaptured: false,
      });
    }

    // Parse the JSON body once. Malformed JSON or a schema mismatch is a
    // CLIENT error (400) — without this guard the raw SyntaxError/ZodError
    // reaches makeShelfError, which doesn't special-case them and returns a
    // generic 500.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ShelfError({
        cause: null,
        message: "Request body must be valid JSON.",
        label: "Booking",
        status: 400,
        shouldBeCaptured: false,
      });
    }

    if (isPost(request)) {
      const { assetModelId, quantity } = parseOr400(UpsertSchema, body);

      await upsertBookingModelRequest({
        bookingId,
        assetModelId,
        quantity,
        organizationId,
        userId: user.id,
      });

      // Return only `{ success: true }` (like DELETE). The client refetches the
      // booking; it never consumes the upserted row, so we don't ship the raw
      // Prisma record (which wouldn't match the client's BookingModelRequest
      // shape anyway).
      return data({ success: true });
    }

    if (isDelete(request)) {
      const { assetModelId } = parseOr400(DeleteSchema, body);

      await removeBookingModelRequest({
        bookingId,
        assetModelId,
        organizationId,
        userId: user.id,
      });

      return data({ success: true });
    }

    // Only POST / DELETE are supported.
    throw notAllowedMethod("POST, DELETE");
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
