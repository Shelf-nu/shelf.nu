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
  noteBookedQuantityChange,
  setStandaloneBookedQuantity,
} from "~/modules/booking/booked-quantity.server";
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
 * Body: {
 *   bookingId: string,
 *   assetIds?: string[],
 *   kitIds?: string[],
 *   quantities?: Record<assetId, number>   // QUANTITY_TRACKED units to book
 * }
 *
 * `quantities` is the mobile twin of the web drawer's per-row quantity input:
 * how many units of each QUANTITY_TRACKED asset to book. An asset missing from
 * the map books 1 unit (the service default), which is also what every older
 * companion build sends. Kit-driven slices never take a quantity here — a kit
 * books whatever the kit holds — so keys for kit-expanded assets are ignored
 * by the service the same way the web drawer never sends them.
 * Availability is enforced server-side inside `addScannedAssetsToBooking`
 * (`assertAssetQuantitiesAvailable` over the booking's own window), so an
 * over-ask fails with the same message web shows.
 *
 * An asset that is ALREADY on the booking (standalone slice) is not inserted
 * again — the service would reject the duplicate row. When the body names a
 * quantity for it, that is a change of the booked amount and goes through the
 * same guarded update as the adjust route; without one it is a no-op. The
 * web picker behaves the same way: re-selecting a booked asset edits its
 * quantity rather than failing.
 *
 * @see {@link file://../../_layout+/bookings.$bookingId.overview.scan-assets.tsx} web twin
 */

const BodySchema = z
  .object({
    bookingId: z.string().min(1),
    assetIds: z.array(z.string().min(1)).optional().default([]),
    kitIds: z.array(z.string().min(1)).optional().default([]),
    // Same bounds as the web picker's `quantitiesSchema`: a positive integer
    // per asset id. Non-integers and zero are rejected at the edge rather than
    // reaching the availability guard as a nonsense ask.
    quantities: z
      .record(z.string().min(1), z.number().int().positive().max(1_000_000))
      .optional()
      .default({}),
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

    const { bookingId, assetIds, kitIds, quantities } = await parseMobileBody(
      BodySchema,
      request,
      "Booking"
    );

    // Org-scoped booking lookup — a foreign-org booking id 404s here.
    const booking = await db.booking.findFirst({
      where: { id: bookingId, organizationId },
      select: {
        id: true,
        name: true,
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

    // Split the standalone ids into "already on the booking" and "new". The
    // existing ones are never re-inserted; a quantity named for one of them
    // is applied as a change of the booked amount instead.
    const existingSlices =
      expandedAssetIds.length > 0
        ? await db.bookingAsset.findMany({
            where: {
              bookingId,
              assetKitId: null,
              assetId: { in: expandedAssetIds },
            },
            select: {
              id: true,
              assetId: true,
              quantity: true,
              asset: {
                select: { title: true, type: true, unitOfMeasure: true },
              },
            },
          })
        : [];
    const existingByAssetId = new Map(
      existingSlices.map((slice) => [slice.assetId, slice])
    );
    const newAssetIds = expandedAssetIds.filter(
      (assetId) => !existingByAssetId.has(assetId)
    );

    let updated = 0;
    for (const slice of existingSlices) {
      const requested = quantities[slice.assetId];
      if (
        requested === undefined ||
        slice.asset.type !== "QUANTITY_TRACKED" ||
        requested === slice.quantity
      ) {
        continue;
      }
      const { previousQuantity } = await setStandaloneBookedQuantity({
        bookingAssetId: slice.id,
        assetId: slice.assetId,
        bookingId,
        organizationId,
        window:
          booking.from && booking.to
            ? { from: booking.from, to: booking.to }
            : null,
        quantity: requested,
        assetTitle: slice.asset.title,
        unitOfMeasure: slice.asset.unitOfMeasure ?? null,
      });
      await noteBookedQuantityChange({
        userId: user.id,
        organizationId,
        bookingId,
        bookingName: booking.name,
        assetId: slice.assetId,
        assetTitle: slice.asset.title,
        previousQuantity,
        quantity: requested,
      });
      updated += 1;
    }

    if (newAssetIds.length > 0 || kitIds.length > 0) {
      await addScannedAssetsToBooking({
        assetIds: newAssetIds,
        kitIds,
        bookingId,
        organizationId,
        userId: user.id,
        quantities,
      });
    }

    return data({ success: true, added: newAssetIds.length, updated });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
