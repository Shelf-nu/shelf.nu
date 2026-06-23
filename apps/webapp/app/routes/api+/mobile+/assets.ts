import { data, type LoaderFunctionArgs } from "react-router";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { getPrimaryLocation } from "~/modules/asset/utils";
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
            custody: {
              custodian: {
                userId: user.id,
              },
            },
          }
        : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
    };

    const [assets, totalCount] = await Promise.all([
      db.asset.findMany({
        where,
        select: {
          id: true,
          title: true,
          status: true,
          mainImage: true,
          mainImageExpiration: true,
          thumbnailImage: true,
          category: { select: { id: true, name: true } },
          // Select location through the pivot and flatten to a singular
          // `location` below to keep the mobile JSON contract flat.
          assetLocations: {
            select: { location: { select: { id: true, name: true } } },
          },
          custody: {
            select: {
              custodian: {
                select: { id: true, name: true },
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

    // Flatten the AssetLocation pivot back to a singular `location` so the
    // mobile JSON contract stays unchanged (Phase 4b).
    const assetsWithLocation = assets.map((asset) => {
      const { assetLocations: _, ...rest } = asset;
      return {
        ...rest,
        location: getPrimaryLocation(asset),
      };
    });

    return data({
      assets: assetsWithLocation,
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
