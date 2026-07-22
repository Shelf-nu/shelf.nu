import { data, type LoaderFunctionArgs } from "react-router";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { makeShelfError } from "~/utils/error";

/**
 * GET /api/mobile/locations?orgId=xxx&search=yyy
 *
 * Returns all locations for the organization.
 * Used by the mobile app's location picker.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);

    const url = new URL(request.url);
    const search = url.searchParams.get("search") || "";

    /**
     * Pagination. The picker must be able to reach EVERY location, not just
     * the first page — a workspace with more rooms than one page could not
     * place an asset in the ones past the cut, and search only helps someone
     * who already knows the name they are looking for.
     *
     * Defaults keep older clients working unchanged: no params means page 1.
     */
    const page = Math.max(
      1,
      parseInt(url.searchParams.get("page") || "1", 10) || 1
    );
    const perPage = Math.min(
      100,
      Math.max(1, parseInt(url.searchParams.get("perPage") || "50", 10) || 50)
    );

    const where = {
      organizationId,
      ...(search
        ? { name: { contains: search, mode: "insensitive" as const } }
        : {}),
    };

    const [locations, totalCount] = await Promise.all([
      db.location.findMany({
        where,
        select: {
          id: true,
          name: true,
          description: true,
          image: true,
          parentId: true,
        },
        orderBy: { name: "asc" },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      db.location.count({ where }),
    ]);

    return data({
      locations,
      page,
      perPage,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / perPage)),
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
