import { data, type LoaderFunctionArgs } from "react-router";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireOrganizationAccess,
  assertMobileCanUseBookings,
} from "~/modules/api/mobile-auth.server";
import { getPaginatedAndFilterableAssets } from "~/modules/asset/service.server";
import {
  resolveDisplayCode,
  labelForPreference,
} from "~/modules/barcode/display";
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
 * @see {@link file://../../_layout+/bookings.$bookingId.overview.manage-assets.tsx} web twin
 */
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
     * The companion's picker has NO pagination UI — `add-assets.tsx` renders a
     * FlatList with no `onEndReached` and no page state, so whatever this one
     * response contains is the entire set the operator can ever browse. The
     * shared service defaults to `perPage = 8`, and the client never sends a
     * `per_page`, so every live 1.1.0 install has been silently capped at 8
     * assets — a workspace with 20 tablecloths could not reach anything else
     * except via search.
     *
     * Until the app ships real infinite scroll (which needs a store release,
     * and there is no OTA channel), request the service's maximum page size
     * whenever the client didn't ask for a specific one. This reaches existing
     * installs with a plain webapp deploy. Rebuilding the params and passing
     * them as `filters` keeps every other query param (booking window,
     * hideUnavailable, search) intact while overriding only the page size.
     */
    const pickerParams = new URL(request.url).searchParams;
    if (!pickerParams.get("per_page")) {
      pickerParams.set("per_page", String(MOBILE_PICKER_MAX_PAGE_SIZE));
    }

    const { assets, page, perPage, totalAssets, totalPages } =
      await getPaginatedAndFilterableAssets({
        request,
        organizationId,
        filters: pickerParams.toString(),
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
            where: { id: { in: assetIds }, organizationId },
            select: {
              id: true,
              sequentialId: true,
              preferredBarcodeId: true,
              qrCodes: { select: { id: true } },
              barcodes: { select: { id: true, type: true, value: true } },
            },
          })
        : Promise.resolve([]),
    ]);
    const codeByAssetId = new Map(codeRows.map((r) => [r.id, r]));

    // Trim to a mobile-friendly payload (mirrors `/api/mobile/assets`).
    return data({
      assets: assets.map((asset) => {
        const codeEntity = codeByAssetId.get(asset.id);
        const resolved = codeEntity
          ? resolveDisplayCode({ entity: codeEntity, organization: org })
          : null;
        return {
          id: asset.id,
          title: asset.title,
          status: asset.status,
          mainImage: asset.mainImage,
          mainImageExpiration: asset.mainImageExpiration,
          thumbnailImage: asset.thumbnailImage,
          // Kit linkage moved to the AssetKit pivot (quantities restructure);
          // the pivot row's `kitId` FK is the legacy single-kit id the companion
          // contract expects.
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
        };
      }),
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
