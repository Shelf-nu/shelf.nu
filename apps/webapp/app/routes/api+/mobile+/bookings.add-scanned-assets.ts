import { AssetType } from "@prisma/client";
import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import { findMobileArchivedRefusal } from "~/modules/api/mobile-archived.server";
import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
  getMobileUserContext,
  assertMobileCanUseBookings,
} from "~/modules/api/mobile-auth.server";
import { parseMobileBody } from "~/modules/api/mobile-body.server";
import {
  assertBookedQuantitiesChangeable,
  noteBookedQuantityChanges,
  setStandaloneBookedQuantities,
  type BookedQuantityChange,
} from "~/modules/booking/booked-quantity.server";
import {
  addScannedAssetsToBooking,
  buildKitSlicesForBooking,
  countArchivedKitMembers,
} from "~/modules/booking/service.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { assertAssetsBelongToOrg } from "~/utils/org-validation.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { canManageBookingItems } from "~/utils/permissions/role-access";
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
 * Status gating mirrors the web manage-items rule (`canManageBookingItems`):
 * COMPLETE / ARCHIVED / CANCELLED bookings reject, and roles held to DRAFT
 * may only add to a DRAFT booking. Callers who do not write every booking may
 * only modify a booking they are the custodian of.
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
 * Response (200):
 *
 *     {
 *       success: true,
 *       added:   { assets: number, kitSlices: number, kits: number },
 *       skipped: { assets: number, kits: number },
 *       updated: number,
 *       archivedKitMembersLeftOut: number,
 *     }
 *
 * `updated` counts the QUANTITY_TRACKED assets already on the booking whose
 * booked amount this scan changed. A resized asset is neither added nor
 * skipped.
 *
 * `archivedKitMembersLeftOut` counts the archived members of the kits this
 * scan added, which a kit add leaves out of the booking (memberships already
 * on it excepted). A kit the scan skipped reports none.
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

    // `booking:update` lets SELF_SERVICE and BASE through the gate above; the
    // caller's access narrows them to their own bookings, and the manage-items
    // rule below to the statuses their policy allows.
    const { access } = await getMobileUserContext(user.id, organizationId);

    // A caller who does not write every booking may only modify their own.
    if (!access.bookings.writeAll && booking.custodianUserId !== user.id) {
      throw new ShelfError({
        cause: null,
        message: "You can only modify your own bookings.",
        label: "Booking",
        status: 403,
        shouldBeCaptured: false,
      });
    }

    if (!canManageBookingItems({ access, bookingStatus: booking.status })) {
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

    // Answer an archived scan by naming the archived rows, so the app marks
    // only those (see mobile-archived.server.ts).
    const archivedRefusal = await findMobileArchivedRefusal({
      assetIds,
      organizationId,
    });
    if (archivedRefusal) {
      return data({ error: archivedRefusal }, { status: 400 });
    }

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
    const existingAssetKitIds = new Set(
      booking.bookingAssets
        .map((row) => row.assetKitId)
        .filter((id): id is string => id !== null)
    );
    const resolvedKitSlices = await buildKitSlicesForBooking({
      kitIds,
      organizationId,
      existingAssetKitIds,
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
     * Dropping the id is right for both asset types. For an INDIVIDUAL asset
     * a second row is meaningless. For a QUANTITY_TRACKED one, a quantity the
     * body names is a change of the booked amount, applied below through the
     * same guarded update as the adjust route; without one the re-scan asks
     * for nothing the booking does not already hold.
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

    // The archived members of the kits this scan added stay out of the
    // booking; the phone's success message says how many, as the web's does.
    // A kit the scan skipped added nothing, so it reports nothing. Read before
    // the write, so a failed count can never report an error for a booking
    // that did change.
    const archivedKitMembersLeftOut = await countArchivedKitMembers({
      kitIds: kitIdsAdded,
      organizationId,
      existingAssetKitIds,
    });

    /**
     * QUANTITY_TRACKED assets already on the booking loose whose quantity the
     * body names and changes: the web picker's "re-select edits the amount".
     * Only assets scanned directly qualify; a kit member's units are the
     * kit's to decide.
     */
    const directlyScannedAssetIds = new Set(assetIds);
    const slicesToResize = existingStandaloneRows.filter((row) => {
      const requested = quantities[row.assetId];
      return (
        directlyScannedAssetIds.has(row.assetId) &&
        !kitSliceAssetIds.has(row.assetId) &&
        row.asset.type === AssetType.QUANTITY_TRACKED &&
        requested !== undefined &&
        requested !== row.quantity
      );
    });

    const window =
      booking.from && booking.to
        ? { from: booking.from, to: booking.to }
        : null;
    const resizes: BookedQuantityChange[] = slicesToResize.map((slice) => ({
      bookingAssetId: slice.id,
      assetId: slice.assetId,
      quantity: quantities[slice.assetId],
      assetTitle: slice.asset.title,
      unitOfMeasure: slice.asset.unitOfMeasure ?? null,
    }));

    // Refuse a resize that cannot pass BEFORE anything is written, so a scan
    // never inserts its new assets and then fails on a held one. The locked
    // check below still decides; this only closes the common case.
    await assertBookedQuantitiesChangeable({
      bookingId,
      organizationId,
      window,
      changes: resizes,
    });

    await addScannedAssetsToBooking({
      assetIds: standaloneAssetIds,
      kitSlices,
      kitIds: kitIdsAdded,
      bookingId,
      organizationId,
      userId: user.id,
      quantities,
      // Re-checks the add rule against the locked status inside the write.
      access,
    });

    // Every resize in one transaction: all of them land or none does.
    const appliedResizes = await setStandaloneBookedQuantities({
      bookingId,
      organizationId,
      window,
      changes: resizes,
    });
    await noteBookedQuantityChanges({
      userId: user.id,
      organizationId,
      bookingId,
      bookingName: booking.name,
      changes: appliedResizes,
      source: "mobile",
    });
    const resizedAssetIds = new Set(appliedResizes.map((c) => c.assetId));

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
        (id) =>
          !addedStandaloneAssetIds.has(id) &&
          !kitSliceAssetIds.has(id) &&
          !resizedAssetIds.has(id)
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
      updated: resizedAssetIds.size,
      archivedKitMembersLeftOut,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
