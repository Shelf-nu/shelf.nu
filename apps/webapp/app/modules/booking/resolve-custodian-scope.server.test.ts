// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "~/database/db.server";
import { resolveCustodianScope } from "./service.server";

// why: resolveCustodianScope is a thin resolver over db.teamMember.findMany;
// mocking the client lets the test pin the query shape and id mapping — the
// crux of the "resolve ALL team-member links, not just one" fix — without a DB.
vi.mock("~/database/db.server", () => ({
  db: { teamMember: { findMany: vi.fn() } },
}));

const findManyMock = vi.mocked(db.teamMember.findMany);

const ORG = "org-1";
const USER = "user-1";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveCustodianScope", () => {
  it("resolves ALL of the user's team-member ids in the org (findMany, not findFirst)", async () => {
    findManyMock.mockResolvedValue([{ id: "tm-1" }, { id: "tm-2" }] as never);

    const scope = await resolveCustodianScope({
      userId: USER,
      organizationId: ORG,
    });

    expect(findManyMock).toHaveBeenCalledWith({
      where: { userId: USER, organizationId: ORG },
      select: { id: true },
    });
    expect(scope).toEqual({
      userId: USER,
      teamMemberIds: ["tm-1", "tm-2"],
    });
  });

  it("returns an empty teamMemberIds when the user has no team member", async () => {
    findManyMock.mockResolvedValue([] as never);

    const scope = await resolveCustodianScope({
      userId: USER,
      organizationId: ORG,
    });

    // Callers that require a team member (index, iCal feed) throw on this;
    // list surfaces fall back to the user link alone.
    expect(scope).toEqual({ userId: USER, teamMemberIds: [] });
  });
});
