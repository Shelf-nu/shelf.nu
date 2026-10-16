/**
 * Mobile booking asset picker endpoint.
 *
 * Serves the companion's "add assets to booking" screen: an availability-aware
 * asset list for a specific date window, plus the display code and resolved
 * image each row renders. It owns no query or availability logic of its own —
 * `getPaginatedAndFilterableAssets` decides what is bookable, and this route
 * shapes that result for a native client that cannot re-resolve relations.
 *
 * Shaping is the part worth knowing: the response carries FLAT, already-resolved
 * image fields rather than the nested `assetModel` relation, because the
 * companion ships as a native binary and must inherit a model's cover image
 * without a client release. See the loader docblock for the request contract.
 *
 * @see {@link file://./../../../modules/asset/image-resolution.ts}
 * @see {@link file://./../../../modules/asset/service.server.ts} getPaginatedAndFilterableAssets
 */
import { data, type LoaderFunctionArgs } from "react-router";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireOrganizationAccess,
  assertMobileCanUseBookings,
  getMobileUserContext,
} from "~/modules/api/mobile-auth.server";
import { getAssetAvailabilityBatch } from "~/modules/asset/availability.server";
import {
  resolveAssetImage,
  serializeImageExpiration,
} from "~/modules/asset/image-resolution";
import {
  ASSET_IMAGE_RESIGN_LIMITS,
  getPaginatedAndFilterableAssets,
  refreshExpiredAssetImages,
} from "~/modules/asset/service.server";
import {
  resolveDisplayCode,
  labelForPreference,
} from "~/modules/barcode/display";
import { canSeeBooking } from "~/utils/booking-authorization.server";
import { makeShelfError } from "~/utils/error";

/**
 * Page size this endpoint requests when the client doesn't specify one.
 * 100 is the ceiling `getPaginatedAndFilterableAssets` accepts (anything above
 * it silently falls back to 20), so this is the most a paginationless client
 * can be given in a single response.
 */
const MOBILE_PICKER_MAX_PAGE_SIZE = 100;

/**
 * GET /api/mobile/bookings/available-assets
 *
 * Availability-aware asset picker for the booking create/edit flow — the mobile
 * twin of the web "manage assets" drawer. Passes through to the shared
 * `getPaginatedAndFilterableAssets` service, which builds the date-overlap
 * availability where-clause (excludes assets in custody, in maintenance, or
 * already reserved/checked-out for the requested window). No new query logic.
 *
 * The availability filter requires a date window: pass `bookingFrom`, `bookingTo`
 * and `hideUnavailable=true`. `unhideAssetsBookigIds=<bookingId>` keeps the
 * current booking's own assets visible when editing. The shared service throws a
 * 400 if `hideUnavailable` is set without both dates.
 *
 * Unlike the simple `/api/mobile/assets` list, this endpoint is purpose-built for
 * bookings, so the picker never offers an asset the server would later reject at
 * reserve/checkout.
 *
 * Query (forwarded to the shared service):
 *   ?orgId & bookingFrom & bookingTo & hideUnavailable=true
 *   & unhideAssetsBookigIds? & s? (search) & page? & per_page? & status?
 *
 * Quantity-tracked rows additionally carry `type`, `quantity` (the pool),
 * `unitOfMeasure` and `availableQuantity`: the units free to book in the
 * requested window, computed by the same `getAssetAvailabilityBatch` the web
 * picker uses, excluding the booking named in `unhideAssetsBookigIds` so its
 * own reservation does not shrink what it may re-book. `bookedQuantity` is what
 * that booking already holds of the row. Both use the named booking only when
 * the caller may see it; otherwise availability excludes nothing and
 * `bookedQuantity` is null, so another member's holdings cannot be probed.
 *
 * A quantity-tracked asset with nothing free stays on the page with
 * `availableQuantity: 0`, and the app shows it as unavailable. Rows are never
 * removed after the service paginates: `page`, `totalCount` and `totalPages`
 * describe the rows the service returned, so a page this route thinned could
 * come back short or empty while later pages still hold bookable assets.
 *
 * INDIVIDUAL rows report `type: "INDIVIDUAL"` and null for the counts.
 *
 * @see {@link file://../../_layout+/bookings.$bookingId.overview.manage-assets.tsx} web twin
 */
/**
 * The booking named by the picker, when the caller may see it.
 *
 * Its own units are excluded from availability and reported as
 * `bookedQuantity`, which reveals what it holds, so a booking the caller may
 * not see (or that is in another workspace) is treated as not named.
 *
 * @returns the booking id, or `undefined` when absent or not visible
 */
async function resolveVisibleBookingId({
  bookingId,
  organizationId,
  userId,
}: {
  bookingId: string | undefined;
  organizationId: string;
  userId: string;
}): Promise<string | undefined> {
  const id = bookingId?.trim();
  if (!id) return undefined;
  const [booking, { access }] = await Promise.all([
    db.booking.findFirst({
      where: { id, organizationId },
      select: {
        id: true,
        custodianUserId: true,
        custodianTeamMember: { select: { userId: true } },
      },
    }),
    getMobileUserContext(userId, organizationId),
  ]);
  return booking && canSeeBooking({ access, booking, userId })
    ? booking.id
    : undefined;
}

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);

    // Bookings are a TEAM-tier (premium) feature — gate this booking-availability
    // read like the mutation routes so PERSONAL workspaces can't query it.
    await assertMobileCanUseBookings(organizationId);

    // The web booking-asset picker (manage-assets) does NOT scope by
    // self-service custody — any bookable asset is selectable, and the
    // self-service restriction is enforced on the mutation, not the read.
    /**
     * A client that sends no `per_page` reads a single response as the whole
     * list, so it gets the service's maximum page size rather than the cookie
     * default of 20. Clients that page send their own size. Passing the
     * rebuilt params as `filters` keeps every other query param (booking
     * window, hideUnavailable, search) intact while overriding only the size.
     */
    const pickerParams = new URL(request.url).searchParams;
    if (!pickerParams.get("per_page")) {
      pickerParams.set("per_page", String(MOBILE_PICKER_MAX_PAGE_SIZE));
    }

    const {
      assets: storedAssets,
      page,
      perPage,
      totalAssets,
      totalPages,
    } = await getPaginatedAndFilterableAssets({
      request,
      organizationId,
      // Mobile asset picker: ignores the custodian-filter seed, so scope it
      // rather than fetch a roster the response never returns.
      canSeeAllCustody: false,
      filters: pickerParams.toString(),
    });

    const assets = await refreshExpiredAssetImages(storedAssets, {
      organizationId,
      ...ASSET_IMAGE_RESIGN_LIMITS,
    });

    // Resolve the workspace's display code (QR Code ID by default, or a SAM ID
    // / barcode per the org's preference) for each asset so the mobile picker
    // can show it on every row — the operator can then match a physical label
    // by eye and toggle the exact unit (web parity: `resolveDisplayCode` +
    // `<AssetCodeBadge>` render this on every web asset row). Narrow, decoupled
    // lookup of the code relations for just this page of ids (mirrors the web
    // fulfil route's supplementary select) so it doesn't depend on the shared
    // service's include shape.
    const assetIds = assets.map((a) => a.id);
    const [org, codeRows] = await Promise.all([
      db.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { qrIdDisplayPreference: true, barcodesEnabled: true },
      }),
      assetIds.length > 0
        ? db.asset.findMany({
            // Bookable pool: archived assets are out of service.
            where: { id: { in: assetIds }, organizationId, archivedAt: null },
            select: {
              id: true,
              sequentialId: true,
              preferredBarcodeId: true,
              qrCodes: { select: { id: true } },
              barcodes: { select: { id: true, type: true, value: true } },
              // Quantity fields ride the same narrow lookup so the row shape
              // does not depend on the shared service's include.
              type: true,
              quantity: true,
              unitOfMeasure: true,
            },
          })
        : Promise.resolve([]),
    ]);
    const codeByAssetId = new Map(codeRows.map((r) => [r.id, r]));

    // Windowed availability for the quantity-tracked rows on this page, in ONE
    // batched read (web parity: `manage-assets.tsx` does the same for its
    // list). The booking being edited is excluded so its own reservation does
    // not count against what it may re-book.
    const bookingFrom = pickerParams.get("bookingFrom");
    const bookingTo = pickerParams.get("bookingTo");
    const excludeBookingId = await resolveVisibleBookingId({
      bookingId: pickerParams.get("unhideAssetsBookigIds")?.split(",")[0],
      organizationId,
      userId: user.id,
    });
    const qtyAssetIds = codeRows
      .filter((r) => r.type === "QUANTITY_TRACKED")
      .map((r) => r.id);
    const [availabilityByAsset, bookedRows] = await Promise.all([
      getAssetAvailabilityBatch(qtyAssetIds, {
        organizationId,
        window:
          bookingFrom && bookingTo
            ? { from: new Date(bookingFrom), to: new Date(bookingTo) }
            : null,
        excludeBookingId,
      }),
      // What this booking already holds of each quantity-tracked row (its
      // standalone slice), so the app can open the quantity sheet on the
      // current amount and say "N booked here" — the web picker's prefill.
      excludeBookingId && qtyAssetIds.length > 0
        ? db.bookingAsset.findMany({
            where: {
              bookingId: excludeBookingId,
              assetKitId: null,
              assetId: { in: qtyAssetIds },
              booking: { organizationId },
            },
            select: { assetId: true, quantity: true },
          })
        : Promise.resolve([]),
    ]);
    const bookedByAssetId = new Map(
      bookedRows.map((row) => [row.assetId, row.quantity])
    );

    // Trim to a mobile-friendly payload (mirrors `/api/mobile/assets`).
    const rows = assets.map((asset) => {
      const codeEntity = codeByAssetId.get(asset.id);
      const isQuantityTracked = codeEntity?.type === "QUANTITY_TRACKED";
      const availableQuantity = isQuantityTracked
        ? availabilityByAsset.get(asset.id)?.bookable ?? 0
        : null;
      const resolved = codeEntity
        ? resolveDisplayCode({
            entity: codeEntity,
            organization: org,
            entityKind: "asset",
          })
        : null;
      return {
        id: asset.id,
        title: asset.title,
        status: asset.status,
        // Hand-written projection, so typecheck can't catch a dropped
        // field — resolve the model-image cascade explicitly or an asset
        // that inherits its image shows blank in the companion's picker.
        ...(() => {
          const image = resolveAssetImage({
            mainImage: asset.mainImage,
            thumbnailImage: asset.thumbnailImage,
            assetModel: asset.assetModel,
          });
          const isPlaceholder = image.source === "placeholder";
          return {
            mainImage: isPlaceholder ? null : image.fullUrl,
            thumbnailImage: isPlaceholder ? null : image.thumbnailUrl,
            imageSource: image.source,
            mainImageExpiration: serializeImageExpiration(
              image.source,
              asset.mainImageExpiration
            ),
          };
        })(),
        // The companion expects one kit id per asset: the first `AssetKit`
        // membership's `kitId`.
        kitId: asset.assetKits?.[0]?.kitId ?? null,
        // The label the operator reads off the physical tag (e.g.
        // "QR Code ID": "w7l4c42u01"). Null when the asset has no resolvable
        // code (older row / partial data) — the picker then just omits it.
        displayCode:
          resolved && resolved.value
            ? {
                value: resolved.value,
                label: labelForPreference(resolved.type),
              }
            : null,
        // Quantity-tracked metadata (additive). Older companion builds
        // ignore these and keep booking one unit.
        type: codeEntity?.type ?? "INDIVIDUAL",
        quantity: isQuantityTracked ? codeEntity?.quantity ?? null : null,
        unitOfMeasure: isQuantityTracked
          ? codeEntity?.unitOfMeasure ?? null
          : null,
        availableQuantity,
        bookedQuantity: isQuantityTracked
          ? bookedByAssetId.get(asset.id) ?? null
          : null,
      };
    });

    return data({
      assets: rows,
      page,
      perPage,
      totalCount: totalAssets,
      totalPages,
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
