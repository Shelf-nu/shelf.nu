/**
 * Location layout route: the header's asset count.
 *
 * The layout loader's `totalAssetsWithinLocation` feeds the header and the
 * start-audit dialog, so it must be the location's total. `getLocation` counts
 * with the same search and custodian filters as the list it heads, so the
 * layout must never forward the Assets tab's search or filters to it.
 *
 * @see {@link file://./../../../app/routes/_layout+/locations.$locationId.tsx}
 * @see {@link file://./../../../app/modules/location/service.server.ts} `getLocation`
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { loader } from "~/routes/_layout+/locations.$locationId";

// why: the location service runs Prisma queries; stubbing it keeps this a unit
// test of what the loader asks getLocation for.
vi.mock("~/modules/location/service.server", () => ({
  assertLocationDeleteConfirmed: vi.fn(),
  deleteLocation: vi.fn(),
  getLocation: vi.fn(),
  getLocationDescendantsTree: vi.fn(),
  getLocationHierarchy: vi.fn(),
}));
// why: the permission resolver needs a session and a database.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

import {
  getLocation,
  getLocationDescendantsTree,
  getLocationHierarchy,
} from "~/modules/location/service.server";
import { requirePermission } from "~/utils/roles.server";

/** Loader args for the location page opened with the given query string. */
function buildArgs(query: string) {
  return {
    request: new Request(
      `http://localhost/locations/location-1/assets${query}`
    ),
    params: { locationId: "location-1" },
    context: { getSession: () => ({ userId: "user-1" }) },
  } as unknown as Parameters<typeof loader>[0];
}

describe("locations.$locationId loader: header asset count", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePermission).mockResolvedValue({
      organizationId: "org-1",
      userOrganizations: [],
    } as never);
    vi.mocked(getLocation).mockResolvedValue({
      // Coordinates already cached, so the loader does not geocode.
      location: {
        id: "location-1",
        name: "Shelf B2",
        latitude: 1,
        longitude: 1,
      },
      totalAssetsWithinLocation: 8,
      assets: [],
    } as never);
    vi.mocked(getLocationHierarchy).mockResolvedValue([] as never);
    vi.mocked(getLocationDescendantsTree).mockResolvedValue([] as never);
  });

  it("asks for the location's total, whatever the Assets tab is filtering", async () => {
    await loader(
      buildArgs("?s=Laerdal&teamMember=tm-1&archived=archived&page=2")
    );

    const args = vi.mocked(getLocation).mock.calls[0]?.[0];
    expect(args?.id).toBe("location-1");
    expect(args?.search).toBeUndefined();
    expect(args?.teamMemberIds).toBeUndefined();
    expect(args?.archivedFilter).toBeUndefined();
  });
});
