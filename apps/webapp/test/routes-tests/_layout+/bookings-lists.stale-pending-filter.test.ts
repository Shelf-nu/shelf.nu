/**
 * Bookings list loaders: a "Pending approval" filter that no longer exists.
 *
 * With both approval switches off the status picker no longer offers
 * "Pending approval", and the bookings query matches nothing for it. Every
 * page that renders the bookings status filter redirects such a request to
 * itself without the status, keeping the rest of the query. The calendar has
 * its own test; this one covers the five bookings lists, so a loader that
 * stops calling the redirect fails here.
 *
 * @see {@link file://../../../app/modules/booking/stale-pending-filter.server.ts}
 * @see {@link file://./calendar.stale-pending-filter.test.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLoaderArgs } from "@mocks/remix";
import { permissionContext } from "@helpers/role-access";

import { db } from "~/database/db.server";
import { getBookingsFilterData } from "~/modules/booking/service.server";
import { loader as assetBookingsLoader } from "~/routes/_layout+/assets.$assetId.bookings";
import { loader as bookingsIndexLoader } from "~/routes/_layout+/bookings._index";
import { loader as kitBookingsLoader } from "~/routes/_layout+/kits.$kitId.bookings";
import { loader as myBookingsLoader } from "~/routes/_layout+/me.bookings";
import { loader as userBookingsLoader } from "~/routes/_layout+/settings.team.users.$userId.bookings";
import { requirePermission } from "~/utils/roles.server";

// @vitest-environment node

// why: the permission gate is exercised elsewhere; this test feeds its result
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

// why: the approval switches are a database read; the test sets them
vi.mock("~/database/db.server", () => ({
  db: { bookingSettings: { findUnique: vi.fn() } },
}));

// why: the bookings index reads its saved filter cookie and query through
// this service before the redirect; every other export is database work that
// a redirected request never reaches
vi.mock("~/modules/booking/service.server", () => ({
  getBookingsFilterData: vi.fn(),
}));

const context = {
  getSession: () => ({ userId: "caller" }),
} as unknown as Parameters<typeof myBookingsLoader>[0]["context"];

type ListLoader = typeof myBookingsLoader;

/** Every bookings list that renders the status filter, with its own path. */
const LISTS: {
  name: string;
  loader: ListLoader;
  path: string;
  params: Record<string, string>;
}[] = [
  {
    name: "bookings index",
    loader: bookingsIndexLoader as ListLoader,
    path: "/bookings",
    params: {},
  },
  {
    name: "my bookings",
    loader: myBookingsLoader,
    path: "/me/bookings",
    params: {},
  },
  {
    name: "an asset's bookings",
    loader: assetBookingsLoader as ListLoader,
    path: "/assets/asset-1/bookings",
    params: { assetId: "asset-1" },
  },
  {
    name: "a kit's bookings",
    loader: kitBookingsLoader as ListLoader,
    path: "/kits/kit-1/bookings",
    params: { kitId: "kit-1" },
  },
  {
    name: "a team member's bookings",
    loader: userBookingsLoader as ListLoader,
    path: "/settings/team/users/user-2/bookings",
    params: { userId: "user-2" },
  },
];

/** Runs `loader` for `url`; returns the Response it produced or threw. */
async function load(
  loader: ListLoader,
  url: string,
  params: Record<string, string>
): Promise<unknown> {
  try {
    return await loader(
      createLoaderArgs({ request: new Request(url), context, params })
    );
  } catch (thrown) {
    return thrown;
  }
}

describe("bookings lists drop a stale Pending approval filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePermission).mockResolvedValue({
      ...(permissionContext({ roles: ["ADMIN"] }) as object),
      currentOrganization: { id: "org-1", type: "TEAM" },
    } as unknown as Awaited<ReturnType<typeof requirePermission>>);
    vi.mocked(db.bookingSettings.findUnique).mockResolvedValue({
      requireApprovalForBase: false,
      requireApprovalForSelfService: false,
    } as never);
  });

  it.each(LISTS)(
    "redirects $name to itself without the status once approval is off",
    async ({ loader, path, params }) => {
      const url = `http://localhost:3000${path}?status=PENDING_APPROVAL&search=drill`;
      vi.mocked(getBookingsFilterData).mockResolvedValue({
        searchParams: new URL(url).searchParams,
        filters: null,
        redirectNeeded: false,
      } as unknown as Awaited<ReturnType<typeof getBookingsFilterData>>);

      const res = (await load(loader, url, params)) as Response;

      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe(`${path}?search=drill`);
    }
  );
});
