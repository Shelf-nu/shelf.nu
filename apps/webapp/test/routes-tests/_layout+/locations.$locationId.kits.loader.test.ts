/**
 * Location Kits tab loader: the custodian filter and the per-page preference.
 *
 * `?teamMember=` is request input applied to a custody clause, so a member who
 * may not see other people's custody must not be able to filter by a
 * colleague. The page-size picker writes `?per_page=`; the loader must store it
 * in the preferences cookie so the choice survives once the parameter is gone.
 *
 * @see {@link file://./../../../app/routes/_layout+/locations.$locationId.kits.tsx}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { loader } from "~/routes/_layout+/locations.$locationId.kits";
import { userPrefs } from "~/utils/cookies.server";
import { CUSTODY_FILTER_REFUSED } from "~/utils/custody-filter";

// why: getLocationKits runs Prisma queries; this test only checks the
// response's cookie.
vi.mock("~/modules/location/service.server", () => ({
  getLocationKits: vi.fn(),
  updateLocationKits: vi.fn(),
}));
// why: the custodian narrowing reads the caller's own team members.
vi.mock("~/database/db.server", () => ({
  db: { teamMember: { findMany: vi.fn() } },
}));
// why: the dropdown's team-member list is a separate query; the narrowing
// helper stays real so the test pins the actual scoping.
vi.mock("~/modules/team-member/service.server", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("~/modules/team-member/service.server")
  >()),
  getTeamMemberForCustodianFilter: vi.fn(),
}));
// why: the permission resolver needs a session and a database.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

import { db } from "~/database/db.server";
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

/** Mocks the permission check for a member who may or may not see all custody. */
function signInAs({ seeAllCustody }: { seeAllCustody: boolean }) {
  vi.mocked(requirePermission).mockResolvedValue({
    organizationId: "org-1",
    access: { custody: { seeAll: seeAllCustody } },
  } as never);
}

/** The custodian ids the loader handed to getLocationKits. */
function custodianIdsSentToGetLocationKits() {
  return vi.mocked(getLocationKits).mock.calls[0]?.[0]?.teamMemberIds;
}

describe("locations.$locationId.kits loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signInAs({ seeAllCustody: true });
    vi.mocked(db.teamMember.findMany).mockResolvedValue([
      { id: "tm-own" },
    ] as never);
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

  it("refuses a colleague's id for a member who may not see all custody", async () => {
    signInAs({ seeAllCustody: false });

    await loader(buildArgs("?teamMember=tm-colleague"));

    expect(custodianIdsSentToGetLocationKits()).toEqual([
      CUSTODY_FILTER_REFUSED,
    ]);
  });

  it("keeps the member's own id and Without custody", async () => {
    signInAs({ seeAllCustody: false });

    await loader(
      buildArgs(
        "?teamMember=tm-own&teamMember=tm-colleague&teamMember=without-custody"
      )
    );

    expect(custodianIdsSentToGetLocationKits()).toEqual([
      "tm-own",
      "without-custody",
    ]);
  });

  it("passes every id through for a member who sees all custody", async () => {
    await loader(buildArgs("?teamMember=tm-colleague"));

    expect(custodianIdsSentToGetLocationKits()).toEqual(["tm-colleague"]);
  });
});
