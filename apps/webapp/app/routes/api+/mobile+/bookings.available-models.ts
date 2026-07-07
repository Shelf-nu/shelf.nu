import { OrganizationRoles } from "@prisma/client";
import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireOrganizationAccess,
  getMobileUserContext,
  assertMobileCanUseBookings,
} from "~/modules/api/mobile-auth.server";
import { getBookingModelTabData } from "~/modules/booking-model-request/service.server";
import { makeShelfError } from "~/utils/error";
import { getParams } from "~/utils/http.server";

/**
 * GET /api/mobile/bookings/available-models?bookingId=…&orgId=…
 *
 * Book-by-model picker for the booking add-assets flow — the mobile twin of
 * the web "Models" tab in the manage-assets drawer
 * (`bookings.$bookingId.overview.manage-assets.tsx`). Wraps the SAME shared
 * `getBookingModelTabData` service the web loader uses, so availability math
 * (total − in-custody − reserved-concrete − reserved-via-request) stays
 * identical across web and mobile. No new query logic here.
 *
 * Returns each `AssetModel` in the workspace with how many units are free to
 * reserve in this booking's window, plus this booking's existing model-level
 * reservations so the app can show current amounts and offer edits.
 *
 * Read-only. Org-scoped, and — like the booking detail read
 * (`bookings.$bookingId.ts`) — custodian-scoped for SELF_SERVICE / BASE so
 * they can only pick models against a booking they own. The actual
 * reserve/edit/remove mutation is enforced separately in
 * `bookings.$bookingId.model-requests.ts`.
 *
 * @see {@link file://./../../_layout+/bookings.$bookingId.overview.manage-assets.tsx} web twin
 * @see {@link file://./../../../modules/booking-model-request/service.server.ts} shared service
 */
export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);

    // Bookings are a TEAM-tier (premium) feature — gate this booking read like
    // the other booking endpoints so a PERSONAL workspace can't query it.
    await assertMobileCanUseBookings(organizationId);

    const url = new URL(request.url);
    const { bookingId } = getParams(
      { bookingId: url.searchParams.get("bookingId") ?? undefined },
      z.object({ bookingId: z.string().min(1) })
    );
    // Optional server-side model name search (`s`), so orgs with more than
    // MODEL_PICKER_LIMIT models can still reach a model that sorts past the
    // first page — the web picker searches server-side, so the app must too.
    const search = url.searchParams.get("s") ?? undefined;

    // Self-service / base users may only see their OWN bookings — scope the
    // lookup by custodian exactly like the booking detail read, so a booking
    // they don't own 404s instead of leaking its models/reservations.
    const { role } = await getMobileUserContext(user.id, organizationId);
    const isSelfServiceOrBase =
      role === OrganizationRoles.SELF_SERVICE ||
      role === OrganizationRoles.BASE;

    const booking = await db.booking.findFirst({
      where: {
        id: bookingId,
        organizationId,
        ...(isSelfServiceOrBase && { custodianUserId: user.id }),
      },
      select: {
        id: true,
        from: true,
        to: true,
        // The booking's existing model-level reservations, shaped exactly as
        // `getBookingModelTabData` expects (`BookingForModelTab`).
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
      return data(
        { error: { message: "Booking not found in this workspace." } },
        { status: 404 }
      );
    }

    const modelTabData = await getBookingModelTabData({
      organizationId,
      booking,
      search,
    });

    // Trim to a mobile-friendly payload. Drop the web-only `initialAssetModels`
    // (shaped for the web DynamicSelect seed list) — the app renders its own
    // list from `assetModels`.
    return data({
      // Whether the workspace has any AssetModel at all (hides the picker).
      showModelsTab: modelTabData.showModelsTab,
      // Per-model availability for this booking's window (first 50 by name).
      assetModels: modelTabData.assetModels.map((m) => ({
        id: m.id,
        name: m.name,
        total: m.total,
        available: m.available,
        inCustody: m.inCustody,
        reservedConcrete: m.reservedConcrete,
        reservedViaRequest: m.reservedViaRequest,
      })),
      // Full workspace model count (the list above is capped) so the app can
      // show a "showing 50 of N — search to narrow" hint.
      totalAssetModels: modelTabData.totalAssetModels,
      // This booking's existing model-level reservations (outstanding +
      // fulfilled), so the picker can pre-fill current amounts.
      modelRequests: modelTabData.modelRequests,
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
