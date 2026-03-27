import { data, type LoaderFunctionArgs } from "react-router";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { makeShelfError } from "~/utils/error";

/**
 * GET /api/mobile/assets?orgId=xxx&search=xxx&page=1&perPage=20&myCustody=true&status=IN_CUSTODY
 *
 * Returns paginated assets for the given organization.
 * Optional filters:
 *   - myCustody=true  → only assets in the current user's custody
 *   - status=X         → filter by asset status (e.g. AVAILABLE, IN_CUSTODY, CHECKED_OUT)
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
      ...(search
        ? {
            title: { contains: search, mode: "insensitive" as const },
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
          thumbnailImage: true,
          category: { select: { id: true, name: true } },
          location: { select: { id: true, name: true } },
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

    return data({
      assets,
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
