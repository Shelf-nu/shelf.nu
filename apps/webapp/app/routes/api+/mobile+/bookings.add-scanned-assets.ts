import { AssetType, OrganizationRoles } from "@prisma/client";
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
 * Response (200):
 *
 *     {
 *       success: true,
 *       added:   { assets: number, kitSlices: number, kits: number },
 *       skipped: { assets: number, kits: number },
 *     }
 *
 * A scan can legitimately put nothing on the booking — every item scanned may
 * already be there — so `added` and `skipped` are what tell a client whether
 * the booking changed. `success` says only that the request was accepted,
 * which is why a wholly-skipped scan is still a 200: nothing failed and
 * nothing was needed. Clients that predate these fields ignore them.
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
        /**
         * The kit memberships already on the booking, and nothing else. This
         * is the set `buildKitSlicesForBooking` subtracts, so re-scanning a
         * kit the booking partly holds tops it up instead of colliding with
         * the rows already there.
         *
         * It stays whole rather than narrowing to the scanned kits:
         * `assetKitId` is a plain FK column carrying no Prisma relation (see
         * the schema — declaring one tips the extended client past TS's
         * recursion limit), so a query cannot traverse from a row to its kit.
         * On a booking holding no kits it matches nothing regardless.
         *
         * The standalone rows this scan could duplicate are read separately
         * below, scoped to the assets it touches: a scanned kit's members
         * belong to that set too, and they are unknown until the memberships
         * resolve.
         */
        bookingAssets: {
          where: { assetKitId: { not: null } },
          select: { assetKitId: true },
        },
      },
    });

    if (!booking) {
      return data(
        { error: { message: "Booking not found in this workspace." } },
        { status: 404 }
      );
    }

    const { role } = await getMobileUserContext(user.id, organizationId);
    // BASE is as restricted as SELF_SERVICE for managing booking assets: own
    // bookings only, and DRAFT only, via `canUserManageBookingAssets`. Both
    // roles hold `booking:update`, so the permission gate above lets them
    // through and this is what narrows them.
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
    const resolvedKitSlices = await buildKitSlicesForBooking({
      kitIds,
      organizationId,
      existingAssetKitIds: new Set(
        booking.bookingAssets
          .map((row) => row.assetKitId)
          .filter((id): id is string => id !== null)
      ),
    });

    /**
     * Every asset this scan touches: the ids scanned directly, plus each
     * member a scanned kit resolved to.
     */
    const scannedAssetIds = [
      ...new Set([
        ...assetIds,
        ...resolvedKitSlices.map((slice) => slice.assetId),
      ]),
    ];

    /**
     * The standalone rows the booking already holds for those assets — the
     * only rows a scan can collide with, which is why this reads them by asset
     * rather than reading the booking's contents whole. It runs after the kit
     * resolution because a kit's members are part of the scan's asset set and
     * are unknown until the memberships come back.
     */
    const existingStandaloneRows =
      scannedAssetIds.length > 0
        ? await db.bookingAsset.findMany({
            where: {
              bookingId: booking.id,
              assetKitId: null,
              assetId: { in: scannedAssetIds },
            },
            select: { assetId: true, asset: { select: { type: true } } },
          })
        : [];

    /**
     * An INDIVIDUAL asset can be on the booking once. If it already sits there
     * loose, a kit that contains it must not book it a second time — the two
     * partial uniques permit one standalone row and one kit-driven row for the
     * same asset, so nothing at the database level would stop it, and the
     * booking would silently hold one physical asset twice. The same net
     * `updateBookingAssets` applies.
     *
     * QUANTITY_TRACKED assets are deliberately not covered: a free-pool slice
     * legitimately coexists with kit-driven ones.
     */
    const individualAssetIdsAlreadyLoose = new Set(
      existingStandaloneRows
        .filter((row) => row.asset.type === AssetType.INDIVIDUAL)
        .map((row) => row.assetId)
    );
    const kitSlices = resolvedKitSlices.filter(
      (slice) => !individualAssetIdsAlreadyLoose.has(slice.assetId)
    );

    /**
     * Assets the booking already holds loose. The service writes one standalone
     * row per id it is handed and checks none of them against what is there, so
     * a second row for the same asset violates the partial unique on
     * `(bookingId, assetId) WHERE assetKitId IS NULL` and the scan fails with a
     * 500 the user can do nothing about.
     *
     * Ordinary use reaches this: the picker deliberately lists the assets this
     * booking has already reserved (that is what `unhideBookingId` is for) and
     * marks none of them as present, so ticking one is a normal thing to do.
     *
     * Dropping the id is right for both asset types HERE. For an INDIVIDUAL
     * asset a second row is meaningless. For a QUANTITY_TRACKED one a re-add
     * could in principle mean "hold more units" — but this endpoint carries no
     * per-asset quantity, so every row it writes is worth one unit and a
     * re-scan can only be asking for what the booking already has. Changing a
     * held quantity is the booking's own quantity control, not a scan.
     */
    const assetIdsAlreadyStandalone = new Set(
      existingStandaloneRows.map((row) => row.assetId)
    );

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
      ...new Set(
        assetIds.filter(
          (id) =>
            !kitSliceAssetIds.has(id) && !assetIdsAlreadyStandalone.has(id)
        )
      ),
    ];

    // Only kits that actually put something on the booking are named. A kit
    // whose every member was already there contributes no slice, and naming it
    // would write a note saying it had been added when nothing was.
    const kitIdsAdded = [...new Set(kitSlices.map((slice) => slice.kitId))];

    await addScannedAssetsToBooking({
      assetIds: standaloneAssetIds,
      kitSlices,
      kitIds: kitIdsAdded,
      bookingId,
      organizationId,
      userId: user.id,
    });

    /**
     * What the scan did NOT put on the booking, because the booking already
     * held it. Derived from the buckets that reached the service, so every
     * guard above and the membership filter inside `buildKitSlicesForBooking`
     * are reflected here without any of them having to report separately.
     *
     * An asset a kit claimed is not skipped — it went on as a kit-driven
     * slice, which is what the scan asked for.
     */
    const addedStandaloneAssetIds = new Set(standaloneAssetIds);
    const skippedAssetIds = new Set(
      assetIds.filter(
        (id) => !addedStandaloneAssetIds.has(id) && !kitSliceAssetIds.has(id)
      )
    );
    const addedKitIds = new Set(kitIdsAdded);
    const skippedKitIds = new Set(kitIds.filter((id) => !addedKitIds.has(id)));

    return data({
      success: true,
      added: {
        assets: standaloneAssetIds.length,
        kitSlices: kitSlices.length,
        kits: kitIdsAdded.length,
      },
      skipped: {
        assets: skippedAssetIds.size,
        kits: skippedKitIds.size,
      },
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
