/**
 * Location Kits tab: the per-page preference.
 *
 * The page-size picker writes `?per_page=`; the loader must store it in the
 * preferences cookie so the choice survives once the query parameter is gone.
 *
 * @see {@link file://./../../../app/routes/_layout+/locations.$locationId.kits.tsx}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { loader } from "~/routes/_layout+/locations.$locationId.kits";
import { userPrefs } from "~/utils/cookies.server";

// why: getLocationKits runs Prisma queries; this test only checks the
// response's cookie.
vi.mock("~/modules/location/service.server", () => ({
  getLocationKits: vi.fn(),
  updateLocationKits: vi.fn(),
}));
// why: the dropdown's team-member list is a separate query.
vi.mock("~/modules/team-member/service.server", () => ({
  getTeamMemberForCustodianFilter: vi.fn(),
}));
// why: the permission resolver needs a session and a database.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

import { getLocationKits } from "~/modules/location/service.server";
import { getTeamMemberForCustodianFilter } from "~/modules/team-member/service.server";
import { requirePermission } from "~/utils/roles.server";

/** Loader args for the Kits tab opened with the given query string. */
function buildArgs(query: string) {
  return {
    request: new Request(`http://localhost/locations/location-1/kits${query}`),
    params: { locationId: "location-1" },
    context: { getSession: () => ({ userId: "user-1" }) },
  } as unknown as Parameters<typeof loader>[0];
}

/** The `Set-Cookie` header the loader's response carries, if any. */
function setCookieHeader(result: unknown) {
  const init = (result as { init?: ResponseInit | null }).init;
  return new Headers(init?.headers).get("Set-Cookie") ?? "";
}

describe("locations.$locationId.kits loader: per-page preference", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePermission).mockResolvedValue({
      organizationId: "org-1",
      access: { custody: { seeAll: true } },
    } as never);
    vi.mocked(getLocationKits).mockResolvedValue({
      kits: [],
      totalKits: 0,
    } as never);
    vi.mocked(getTeamMemberForCustodianFilter).mockResolvedValue({
      teamMembers: [],
      totalTeamMembers: 0,
    } as never);
  });

  it("stores the chosen page size in the preferences cookie", async () => {
    const result = await loader(buildArgs("?per_page=50"));

    const prefs = await userPrefs.parse(setCookieHeader(result));
    expect(prefs?.perPage).toBe(50);
  });
});
