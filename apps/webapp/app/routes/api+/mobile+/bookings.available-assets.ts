import { data, type LoaderFunctionArgs } from "react-router";
import {
  requireMobileAuth,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { getPaginatedAndFilterableAssets } from "~/modules/asset/service.server";
import { makeShelfError } from "~/utils/error";

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
 * @see {@link file://../../_layout+/bookings.$bookingId.overview.manage-assets.tsx} web twin
 */
export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);

    // The web booking-asset picker (manage-assets) does NOT scope by
    // self-service custody — any bookable asset is selectable, and the
    // self-service restriction is enforced on the mutation, not the read.
    const { assets, page, perPage, totalAssets, totalPages } =
      await getPaginatedAndFilterableAssets({ request, organizationId });

    // Trim to a mobile-friendly payload (mirrors `/api/mobile/assets`).
    return data({
      assets: assets.map((asset) => ({
        id: asset.id,
        title: asset.title,
        status: asset.status,
        mainImage: asset.mainImage,
        mainImageExpiration: asset.mainImageExpiration,
        thumbnailImage: asset.thumbnailImage,
        kitId: asset.kitId,
      })),
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
