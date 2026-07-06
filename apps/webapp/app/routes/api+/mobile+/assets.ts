import { data, type LoaderFunctionArgs } from "react-router";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireOrganizationAccess,
  shapeMobileAssetResponse,
} from "~/modules/api/mobile-auth.server";
import { makeShelfError } from "~/utils/error";

/**
 * GET /api/mobile/assets?orgId=xxx&search=xxx&page=1&perPage=20&myCustody=true&status=IN_CUSTODY
 *
 * Returns paginated assets for the given organization.
 * Optional filters:
 *   - myCustody=true  → only assets in the current user's custody
 *   - status=X         → filter by asset status (e.g. AVAILABLE, IN_CUSTODY, CHECKED_OUT)
 *
 * Image URLs are returned as-stored along with `mainImageExpiration`. Mobile
 * clients should call `/api/mobile/asset/refresh-image/:assetId` lazily when
 * they detect an expired URL — keeps this loader read-only and avoids fanning
 * out N writes per paginated read.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);

    const url = new URL(request.url);

    // Validate and sanitize search input
    const rawSearch = url.searchParams.get("search") || "";
    const search = rawSearch.slice(0, 100);

    // Parse pagination with NaN guards
    const rawPage = parseInt(url.searchParams.get("page") || "1", 10);
    const page = Number.isNaN(rawPage) ? 1 : Math.max(1, rawPage);

    const rawPerPage = parseInt(url.searchParams.get("perPage") || "20", 10);
    const perPage = Number.isNaN(rawPerPage)
      ? 20
      : Math.min(50, Math.max(1, rawPerPage));

    const skip = (page - 1) * perPage;

    // Optional filters
    const myCustody = url.searchParams.get("myCustody") === "true";
    const statusFilter = url.searchParams.get("status");

    const where: Record<string, unknown> = {
      organizationId,
      // Match on title OR sequentialId (SAM id, e.g. "SAM-0001"). When the
      // workspace display preference is SAM, every asset row shows its SAM id,
      // so a user typing that number must be able to find it here. Mirrors the
      // web search's sequentialId branch (modules/asset/service.server.ts) but
      // intentionally NOT the heavy branches (custodian-name traversal,
      // custom-fields JSON) — those are slow and low-value on mobile.
      // `sequentialId` is indexed; a normal word term can't false-positive it.
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: "insensitive" as const } },
              {
                sequentialId: {
                  contains: search,
                  mode: "insensitive" as const,
                },
              },
            ],
          }
        : {}),
      ...(myCustody
        ? {
            // Phase 2/4 widened `Asset.custody` from 1:1 to 1:many for
            // QUANTITY_TRACKED multi-custodian support, so we must filter
            // via `some`. Without `some:`, Prisma rejects the where clause
            // at runtime and the Custody tab returns 500. Mirrors the
            // dashboard endpoint's myCustody count filter.
            custody: {
              some: {
                custodian: {
                  userId: user.id,
                },
              },
            },
          }
        : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
    };

    const [assets, totalCount] = await Promise.all([
      db.asset.findMany({
        where,
        // Mirrors `MOBILE_ASSET_SELECT` (the canonical shape consumed by
        // `shapeMobileAssetResponse`) PLUS list-only extras the companion
        // already consumes: `mainImageExpiration` (drives the lazy
        // refresh-image flow), `thumbnailImage`, and `category.id`. Keeping
        // these here — rather than narrowing to `MOBILE_ASSET_SELECT` —
        // preserves the legacy list-response contract for the in-App-Store
        // companion (since 2026-05-20).
        select: {
          id: true,
          title: true,
          status: true,
          mainImage: true,
          mainImageExpiration: true,
          thumbnailImage: true,
          // why: powers the scan-to-booking "not available to book" blocker.
          availableToBook: true,
          // Quantity fields (additive) — mirror `MOBILE_ASSET_SELECT` so the
          // helper's now-required quantity scalars are satisfied and the
          // companion list can DISPLAY quantity. Null for INDIVIDUAL assets.
          type: true,
          quantity: true,
          minQuantity: true,
          unitOfMeasure: true,
          consumptionType: true,
          // Keep `id` (list extra); helper only types `{ name }` but
          // structurally accepts the wider shape.
          category: { select: { id: true, name: true } },
          // Kit linkage via the AssetKit pivot — flattened to top-level
          // `kit` + `kitId` by `shapeMobileAssetResponse`.
          assetKits: {
            select: { kit: { select: { id: true, name: true } } },
          },
          // Location via the AssetLocation pivot — flattened to top-level
          // `location` by the helper.
          assetLocations: {
            select: { location: { select: { id: true, name: true } } },
          },
          // Custody is now 1:many (Phase 2/4); helper flattens `custody[0]`
          // so the companion's single-or-null `asset.custody?.custodian`
          // read keeps working. `quantity` feeds the helper's many-aware
          // `custodyList`.
          custody: {
            // Oldest-first so the flattened single custody + custodyList are
            // deterministic (the relation is otherwise unordered).
            orderBy: { createdAt: "asc" as const },
            select: {
              quantity: true,
              // why: operator-vs-kit discriminator for `releasableQuantity`.
              kitCustodyId: true,
              custodian: {
                // why: `userId` lets the app recognize the caller's own row.
                select: { id: true, name: true, userId: true },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: perPage,
      }),
      db.asset.count({ where }),
    ]);

    // Flatten kit/location/custody pivots into the legacy flat shape via the
    // shared helper, then re-attach the list-only extras
    // (`mainImageExpiration`, `thumbnailImage`) that the helper's return type
    // doesn't carry but the companion list view consumes.
    const shapedAssets = assets.map((asset) => {
      const { mainImageExpiration, thumbnailImage, ...assetForHelper } = asset;
      return {
        ...shapeMobileAssetResponse(assetForHelper),
        mainImageExpiration,
        thumbnailImage,
      };
    });

    return data({
      assets: shapedAssets,
      page,
      perPage,
      totalCount,
      totalPages: Math.ceil(totalCount / perPage),
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
