/**
 * Mobile Locations API
 *
 * Lists a workspace's locations for the companion app. Two kinds of caller
 * share it: the full-screen location picker, which pages, and the asset
 * create and edit forms, which send no paging params and get the whole list
 * (see the loader).
 *
 * @see {@link file://./../../../../test/routes-tests/api+/mobile+/locations.test.ts}
 * @see {@link file://./../../../../../companion/lib/api/assets.ts} `locations`
 */
import { data, type LoaderFunctionArgs } from "react-router";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { parseMobilePagination } from "~/modules/api/mobile-pagination";
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
     *   up to `UNPAGED_LOCATIONS_CAP`, with `totalCount` and `truncated`
     *   instead of paging fields: there is no next page in this mode, so the
     *   response never advertises one. Those forms read only `locations`, so
     *   rows past the cap stay out of reach there.
     */
    const isPaged =
      url.searchParams.has("page") || url.searchParams.has("perPage");
    const { page, perPage, skip } = isPaged
      ? parseMobilePagination(url.searchParams, {
          defaultPerPage: 50,
          maxPerPage: 100,
        })
      : { page: 1, perPage: UNPAGED_LOCATIONS_CAP, skip: 0 };

    const where = {
      organizationId,
      ...(search
        ? { name: { contains: search, mode: "insensitive" as const } }
        : {}),
    };

    const rowsQuery = db.location.findMany({
      where,
      select: {
        id: true,
        name: true,
        description: true,
        // Never the `image` relation: that row carries the stored file bytes.
        thumbnailUrl: true,
        imageUrl: true,
        parentId: true,
      },
      // `id` breaks ties between same-named locations so a row never moves
      // across a page boundary between requests.
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip,
      take: perPage,
    });

    let rows: Awaited<typeof rowsQuery>;
    let totalCount: number;
    if (isPaged) {
      [rows, totalCount] = await Promise.all([
        rowsQuery,
        db.location.count({ where }),
      ]);
    } else {
      // An unpaged list under the cap is the whole list, so its length is the
      // count. Only a list that reached the cap needs the separate count.
      rows = await rowsQuery;
      totalCount =
        rows.length < UNPAGED_LOCATIONS_CAP
          ? rows.length
          : await db.location.count({ where });
    }

    // The companion's `Location.image` is a URL string or null: the
    // thumbnail, else the full image, as the web location image shows.
    const locations = rows.map(({ thumbnailUrl, imageUrl, ...location }) => ({
      ...location,
      image: thumbnailUrl ?? imageUrl,
    }));

    if (!isPaged) {
      return data({
        locations,
        totalCount,
        truncated: totalCount > locations.length,
      });
    }

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
