import { data, type LoaderFunctionArgs } from "react-router";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { makeShelfError } from "~/utils/error";

/**
 * Most locations returned to a request that sends no paging params. Keeps one
 * response bounded while covering every realistic workspace in full.
 */
const UNPAGED_LOCATIONS_CAP = 1000;

/**
 * GET /api/mobile/locations?orgId=xxx&search=yyy[&page=n][&perPage=n]
 *
 * Returns the organization's locations, ordered by name, for the companion
 * app's location picker and its asset create and edit forms.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);

    const url = new URL(request.url);
    const search = url.searchParams.get("search") || "";

    /**
     * Two kinds of caller share this endpoint:
     *
     * - The full-screen location picker pages explicitly with `page` and/or
     *   `perPage` (50 per page by default, at most 100).
     * - The asset create and edit forms send neither and search the response
     *   on the device, so a location missing from that one response cannot be
     *   picked there at all. Without paging params the whole list comes back,
     *   bounded by `UNPAGED_LOCATIONS_CAP`; `totalPages` above 1 tells the
     *   client the list was cut.
     */
    const isPaged =
      url.searchParams.has("page") || url.searchParams.has("perPage");
    const page = isPaged
      ? Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1)
      : 1;
    const perPage = isPaged
      ? Math.min(
          100,
          Math.max(
            1,
            parseInt(url.searchParams.get("perPage") || "50", 10) || 50
          )
        )
      : UNPAGED_LOCATIONS_CAP;

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
