/**
 * The kits list where-clause, and the custodian filter in particular.
 *
 * The custodian control is a multi-select: `DynamicDropdown` defaults to
 * `selectionMode: "append"` and seeds itself from `searchParams.getAll`, so the
 * URL carries one `teamMember` value per chosen custodian. Reading only the first
 * silently narrows the filter to one of them while the UI shows several as
 * active.
 *
 * The allow-list half matters as much: `?teamMember=` is raw request input, and a
 * viewer who may not see all custody must not be able to filter by a colleague's
 * id and read back what that person holds.
 *
 * @see {@link file://./utils.server.ts}
 * @see {@link file://./../asset/utils.server.ts} getAssetsWhereInput, the twin
 */
import { describe, expect, it } from "vitest";

import { CUSTODY_FILTER_REFUSED } from "~/utils/custody-filter";

import { getKitsWhereInput } from "./utils.server";

describe("getKitsWhereInput", () => {
  const organizationId = "org-1";

  it("scopes to the organization with no params", () => {
    expect(
      getKitsWhereInput({
        organizationId,
        currentSearchParams: null,
        allowedTeamMemberIds: "all",
      })
    ).toEqual({ organizationId });
  });

  it("applies every selected custodian, not just the first", () => {
    const where = getKitsWhereInput({
      organizationId,
      currentSearchParams: "teamMember=tm-1&teamMember=tm-2",
      allowedTeamMemberIds: "all",
    });

    expect(where.custody).toEqual({
      custodianId: { in: ["tm-1", "tm-2"] },
    });
  });

  it("applies a single selected custodian", () => {
    const where = getKitsWhereInput({
      organizationId,
      currentSearchParams: "teamMember=tm-1",
      allowedTeamMemberIds: "all",
    });

    expect(where.custody).toEqual({ custodianId: { in: ["tm-1"] } });
  });

  it("adds no custody clause when no custodian was chosen", () => {
    const where = getKitsWhereInput({
      organizationId,
      currentSearchParams: "s=camera",
      allowedTeamMemberIds: "all",
    });

    expect(where.custody).toBeUndefined();
  });

  it("keeps only the custodians the viewer is allowed to filter by", () => {
    const where = getKitsWhereInput({
      organizationId,
      currentSearchParams: "teamMember=tm-self&teamMember=tm-colleague",
      allowedTeamMemberIds: ["tm-self"],
    });

    expect(where.custody).toEqual({ custodianId: { in: ["tm-self"] } });
  });

  it("refuses the filter when none of the chosen custodians is allowed", () => {
    // Refused rather than dropped: an empty list would read as "no filter" and
    // widen the query back to every kit in the workspace, which is the opposite
    // of what a refusal should do.
    const where = getKitsWhereInput({
      organizationId,
      currentSearchParams: "teamMember=tm-colleague",
      allowedTeamMemberIds: ["tm-self"],
    });

    expect(where.custody).toEqual({
      custodianId: { in: [CUSTODY_FILTER_REFUSED] },
    });
  });

  it("still applies the search and status filters", () => {
    const where = getKitsWhereInput({
      organizationId,
      currentSearchParams: "s=Camera&status=AVAILABLE",
      allowedTeamMemberIds: "all",
    });

    expect(where.name).toEqual({ contains: "camera", mode: "insensitive" });
    expect(where.status).toBe("AVAILABLE");
  });
});
