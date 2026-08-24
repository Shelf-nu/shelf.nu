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
import { removeAssets } from "~/modules/booking/service.server";
import { canSeeBooking } from "~/utils/booking-authorization.server";
import { canUserRemoveBookingAssets } from "~/utils/bookings";
import { makeShelfError, ShelfError } from "~/utils/error";
import { assertAssetsBelongToOrg } from "~/utils/org-validation.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { enforceUserRateLimit } from "~/utils/rate-limit.server";

/**
 * POST /api/mobile/bookings/remove-assets
 *
 * Removes assets and/or kits from a booking — the mobile twin of the web
 * booking manage-assets "remove" path. Wraps the shared `removeAssets` service
 * so the `BOOKING_ASSETS_REMOVED` events, removal notes and the asset-status
 * reset (back to AVAILABLE for ONGOING/OVERDUE bookings) stay identical to web.
 * Kits are expanded to their contained assets (org-scoped), mirroring the kit
 * handling in `add-scanned-assets`.
 *
 * Adding assets/kits is handled by the existing `add-scanned-assets` endpoint;
 * this endpoint is the removal counterpart for the picker-based edit flow.
 *
 * Status gating uses `canUserRemoveBookingAssets` (COMPLETE / ARCHIVED /
 * CANCELLED reject), plus an explicit own-booking guard for self-service and
 * BASE users. Note this is intentionally looser than the ADD counterpart: a
 * custodian may remove items from their own booking in any non-finished
 * status, matching the web booking-overview remove actions.
 *
 * Body: { bookingId: string, assetIds?: string[], kitIds?: string[] }
 * Query: ?orgId=...
 *
 * @see {@link file://./bookings.add-scanned-assets.ts} the add counterpart
 * @see {@link file://../../_layout+/bookings.$bookingId.overview.manage-assets.tsx} web twin
 */

const BodySchema = z
  .object({
    bookingId: z.string().min(1),
    assetIds: z.array(z.string().min(1)).optional().default([]),
    kitIds: z.array(z.string().min(1)).optional().default([]),
  })
  .refine((body) => body.assetIds.length > 0 || body.kitIds.length > 0, {
    message: "Select at least one asset or kit to remove.",
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
        // BOTH custody links are needed. A booking assigned to a team member
        // before a user was attached to it keeps `custodianUserId = NULL` even
        // after the invite is accepted, so the user link alone fails closed for
        // the very users those bookings belong to. See `canSeeBooking`.
        custodianUserId: true,
        custodianTeamMember: { select: { userId: true } },
      },
    });

    if (!booking) {
      return data(
        { error: { message: "Booking not found in this workspace." } },
        { status: 404 }
      );
    }

    const { role } = await getMobileUserContext(user.id, organizationId);
    // BASE is as restricted as SELF_SERVICE for managing booking assets: both
    // may only touch their OWN bookings (enforced just below). Keying only on
    // SELF_SERVICE let a BASE user with `booking:update` edit anyone's booking
    // via this endpoint.
    const isSelfServiceOrBase =
      role === OrganizationRoles.SELF_SERVICE ||
      role === OrganizationRoles.BASE;

    // Self-service / BASE users may only modify their own bookings. Reuses the
    // shared custody predicate rather than comparing `custodianUserId` alone:
    // that narrower test 403s a custodian whose booking is held through the
    // team-member link, which is precisely the user this endpoint's removal
    // parity is meant to serve.
    const ownsBooking = canSeeBooking({
      canSeeAllBookings: false,
      booking,
      userId: user.id,
    });
    if (isSelfServiceOrBase && !ownsBooking) {
      throw new ShelfError({
        cause: null,
        message: "You can only modify your own bookings.",
        label: "Booking",
        status: 403,
        shouldBeCaptured: false,
      });
    }

    // Status only. `canUserManageBookingAssets` (which the ADD counterpart
    // uses) additionally pins self-service/BASE to DRAFT, which blocked a
    // custodian from removing an item from their OWN reserved booking — the
    // web allows exactly that, and the two surfaces must agree. Ownership is
    // already enforced by the own-booking guard directly above.
    if (!canUserRemoveBookingAssets(booking)) {
      throw new ShelfError({
        cause: null,
        title: "Action not allowed",
        message:
          "Assets cannot be removed from this booking in its current status.",
        additionalData: { userId, bookingId, status: booking.status },
        label: "Booking",
        status: 403,
        shouldBeCaptured: false,
      });
    }

    // Org-scope the caller-supplied (standalone) asset ids before disconnecting.
    await assertAssetsBelongToOrg({ assetIds, organizationId });

    // Expand kits to their contained assets (org-scoped). The service
    // disconnects the assets and uses `kitIds` / `kits` for the status reset and
    // removal notes — mirrors the kit expansion in `add-scanned-assets`.
    let kits: { id: string; name: string }[] = [];
    let kitAssetIds: string[] = [];
    if (kitIds.length > 0) {
      const [kitRecords, kitAssets] = await Promise.all([
        db.kit.findMany({
          where: { id: { in: kitIds }, organizationId },
          select: { id: true, name: true },
        }),
        db.asset.findMany({
          // Kit membership is the AssetKit pivot now (quantities restructure).
          where: {
            assetKits: { some: { kitId: { in: kitIds } } },
            organizationId,
          },
          select: { id: true },
        }),
      ]);
      kits = kitRecords;
      kitAssetIds = kitAssets.map((asset) => asset.id);
    }

    const candidateAssetIds = [...new Set([...assetIds, ...kitAssetIds])];

    // Only disconnect assets ACTUALLY attached to THIS booking. A caller can
    // supply any org asset id; removing one that isn't on the booking would
    // inflate removedCount and write a misleading "removed" note. The
    // `bookings: { some }` filter scopes both the disconnect set and the
    // note titles to real members.
    const assets = await db.asset.findMany({
      where: {
        id: { in: candidateAssetIds },
        organizationId,
        // Asset↔booking membership is the BookingAsset pivot now (quantities).
        bookingAssets: { some: { bookingId } },
      },
      select: { id: true, title: true },
    });
    const attachedAssetIds = assets.map((asset) => asset.id);

    // Whatever the caller put in `assetIds` is an explicit "remove this
    // asset's own row" instruction — that is the endpoint's contract. So a
    // directly-requested asset stays in the standalone bucket even when it
    // ALSO belongs to a kit in `kitIds`: a qty-tracked asset can hold both a
    // standalone row and a kit-driven row on one booking, and the caller
    // asked for both. Narrowed to rows actually attached to this booking.
    const requestedAssetIdSet = new Set(assetIds);
    const standaloneAssetIds = attachedAssetIds.filter((assetId) =>
      requestedAssetIdSet.has(assetId)
    );

    // `assets` drives the booking-note phrasing only ("… removed {kits} and
    // {assets} from booking"), NOT what gets detached. Members pulled in by a
    // kit are already covered by the kit half of the note, so listing them
    // again duplicates them (and turns a kit-only removal into a note naming
    // every member). Mirrors the web bulk-remove handler.
    const standaloneAssetIdSet = new Set(standaloneAssetIds);
    const standaloneAssets = assets.filter((asset) =>
      standaloneAssetIdSet.has(asset.id)
    );

    const updated = await removeAssets({
      booking: { id: bookingId, assetIds: attachedAssetIds },
      kitIds,
      kits,
      standaloneAssetIds,
      firstName: user.firstName ?? "",
      lastName: user.lastName ?? "",
      userId: user.id,
      assets: standaloneAssets,
      organizationId,
    });

    return data({
      booking: {
        id: updated.id,
        name: updated.name,
        status: updated.status,
      },
      removedCount: attachedAssetIds.length,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
