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
import { addScannedAssetsToBooking } from "~/modules/booking/service.server";
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
 * service (kit expansion, status sync, notes, events stay identical).
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

    const { bookingId, assetIds, kitIds } = BodySchema.parse(
      await request.json()
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

    // Expand kits to their contained assets — the service only connects
    // `assetIds` to the booking (`kitIds` drives status flags and notes).
    // The web drawer does this expansion client-side; doing it here keeps
    // the mobile client thin and the expansion org-scoped.
    //
    // Asset-Kit membership lives on the `AssetKit` pivot (no direct
    // `Asset.kitId` field on the feat-quantities branch). Filter assets by
    // their pivot rows; org-scoping the Asset itself keeps the query tenant-safe.
    let expandedAssetIds = assetIds;
    if (kitIds.length > 0) {
      const kitAssets = await db.asset.findMany({
        where: {
          organizationId,
          assetKits: { some: { kitId: { in: kitIds } } },
        },
        select: { id: true },
      });
      expandedAssetIds = [
        ...new Set([...assetIds, ...kitAssets.map((a) => a.id)]),
      ];
    }

    await addScannedAssetsToBooking({
      assetIds: expandedAssetIds,
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
