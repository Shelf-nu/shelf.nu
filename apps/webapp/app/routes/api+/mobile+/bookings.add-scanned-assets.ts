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
import {
  addScannedAssetsToBooking,
  buildKitSlicesForBooking,
} from "~/modules/booking/service.server";
import { canUserManageBookingAssets } from "~/utils/bookings";
import { makeShelfError, ShelfError } from "~/utils/error";
import { assertAssetsBelongToOrg } from "~/utils/org-validation.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { enforceUserRateLimit } from "~/utils/rate-limit.server";

/**
 * POST /api/mobile/bookings/add-scanned-assets
 *
 * Adds scanned assets and/or kits to a booking — the mobile twin of the web
 * scanner's add-to-booking flow. Wraps the same `addScannedAssetsToBooking`
 * service, so notes and events are identical on both platforms.
 *
 * The two clients differ in who resolves a kit's members: the web drawer sends
 * ready-made kit slices, while the phone sends kit ids and this route resolves
 * them, keeping the mobile client thin and the lookup org-scoped.
 *
 * Status/role gating mirrors the web (`canUserManageBookingAssets`):
 * COMPLETE / ARCHIVED / CANCELLED bookings reject; SELF_SERVICE users may
 * only modify their own DRAFT bookings.
 *
 * Body: { bookingId: string, assetIds?: string[], kitIds?: string[] }
 *
 * @see {@link file://../../_layout+/bookings.$bookingId.overview.scan-assets.tsx} web twin
 */

const BodySchema = z
  .object({
    bookingId: z.string().min(1),
    assetIds: z.array(z.string().min(1)).optional().default([]),
    kitIds: z.array(z.string().min(1)).optional().default([]),
  })
  .refine((body) => body.assetIds.length > 0 || body.kitIds.length > 0, {
    message: "Scan at least one asset or kit to add.",
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

    // Bookings are a TEAM-tier (premium) feature. Every other booking mutation
    // gates here; without it a PERSONAL workspace could add assets via mobile,
    // bypassing the entitlement the web enforces.
    await assertMobileCanUseBookings(organizationId);

    const { bookingId, assetIds, kitIds } = await parseMobileBody(
      BodySchema,
      request,
      "Booking"
    );

    // Org-scoped booking lookup — a foreign-org booking id 404s here.
    const booking = await db.booking.findFirst({
      where: { id: bookingId, organizationId },
      select: {
        id: true,
        status: true,
        from: true,
        to: true,
        custodianUserId: true,
        // Which kit memberships the booking already holds, so re-adding a kit
        // that is partly on it adds only the missing members instead of
        // colliding with the rows already there.
        bookingAssets: { select: { assetKitId: true } },
      },
    });

    if (!booking) {
      return data(
        { error: { message: "Booking not found in this workspace." } },
        { status: 404 }
      );
    }

    const { role } = await getMobileUserContext(user.id, organizationId);
    // BASE is as restricted as SELF_SERVICE for managing booking assets (own
    // bookings only, DRAFT only via canUserManageBookingAssets). Keying only on
    // SELF_SERVICE let a BASE user with `booking:update` add assets to anyone's
    // non-draft booking via this endpoint.
    const isSelfServiceOrBase =
      role === OrganizationRoles.SELF_SERVICE ||
      role === OrganizationRoles.BASE;

    // Self-service / BASE users may only modify their own bookings.
    if (isSelfServiceOrBase && booking.custodianUserId !== user.id) {
      throw new ShelfError({
        cause: null,
        message: "You can only modify your own bookings.",
        label: "Booking",
        status: 403,
        shouldBeCaptured: false,
      });
    }

    if (!canUserManageBookingAssets(booking, isSelfServiceOrBase)) {
      throw new ShelfError({
        cause: null,
        title: "Action not allowed",
        message:
          "Assets cannot be added to this booking in its current status.",
        additionalData: { userId, bookingId, status: booking.status },
        label: "Booking",
        status: 403,
        shouldBeCaptured: false,
      });
    }

    // Org-scope the caller-supplied asset ids before they are connected to the
    // booking. The downstream service connects them by id with no org check, so
    // without this a caller could attach another workspace's assets (cross-org
    // IDOR). Kit-derived asset ids are already org-scoped by the query below.
    await assertAssetsBelongToOrg({ assetIds, organizationId });

    /**
     * Resolve each scanned kit into one slice per `AssetKit` membership.
     *
     * A kit's members must reach the booking as kit-driven rows, carrying the
     * membership they came from: `BookingAsset.assetKitId` is what every
     * surface reads to group an asset under its kit, and `sourceKitId` is what
     * keeps that provenance after the membership row goes away. Adding the
     * members as loose asset ids instead puts them on the booking with no kit
     * to belong to, so neither the phone nor the website can show the kit they
     * were scanned as.
     *
     * The lookup is org-scoped by `AssetKit.organizationId`, so a foreign kit
     * id resolves to no slices rather than reaching another workspace's
     * memberships. The mobile client sends kit ids only — the web drawer
     * resolves the same slices in the browser and posts them.
     */
    const kitSlices = await buildKitSlicesForBooking({
      kitIds,
      organizationId,
      existingAssetKitIds: new Set(
        booking.bookingAssets
          .map((row) => row.assetKitId)
          .filter((id): id is string => id !== null)
      ),
    });

    // An asset can be scanned on its own AND as part of a kit in the same
    // batch. The kit slice is the more specific of the two, so it takes the
    // asset and the standalone bucket keeps only what no kit claimed.
    //
    // Deduplicated because one standalone row per entry is what the service
    // writes, and a second row for the same asset breaks the partial unique on
    // `(bookingId, assetId) WHERE assetKitId IS NULL`. The app's own callers
    // send distinct ids, but this is a request body and cannot rely on that.
    const kitSliceAssetIds = new Set(kitSlices.map((slice) => slice.assetId));
    const standaloneAssetIds = [
      ...new Set(assetIds.filter((id) => !kitSliceAssetIds.has(id))),
    ];

    await addScannedAssetsToBooking({
      assetIds: standaloneAssetIds,
      kitSlices,
      kitIds,
      bookingId,
      organizationId,
      userId: user.id,
    });

    return data({ success: true });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
