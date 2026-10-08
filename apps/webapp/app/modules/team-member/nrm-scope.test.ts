import { InviteStatuses } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { ALL_SELECTED_KEY } from "~/utils/list";
import { getNrmIndexWhere, getNrmSelectionWhere } from "./nrm-scope";

const ORG = "org-1";

describe("getNrmIndexWhere", () => {
  it("excludes soft-deleted members, registered users and pending invites", () => {
    expect(getNrmIndexWhere({ organizationId: ORG })).toEqual({
      deletedAt: null,
      organizationId: ORG,
      userId: null,
      receivedInvites: { none: { status: InviteStatuses.PENDING } },
    });
  });

  it("adds a name/user search when one is supplied", () => {
    const where = getNrmIndexWhere({ organizationId: ORG, search: "john" });

    expect(where.OR).toEqual([
      { name: { contains: "john", mode: "insensitive" } },
      { user: { firstName: { contains: "john", mode: "insensitive" } } },
      { user: { lastName: { contains: "john", mode: "insensitive" } } },
      { user: { displayName: { contains: "john", mode: "insensitive" } } },
    ]);
  });

  it("omits the search clause for empty or absent search", () => {
    expect(
      getNrmIndexWhere({ organizationId: ORG, search: "" }).OR
    ).toBeUndefined();
    expect(
      getNrmIndexWhere({ organizationId: ORG, search: null }).OR
    ).toBeUndefined();
  });
});

describe("getNrmSelectionWhere", () => {
  it("keeps the full NRM scope on select-all instead of widening to the whole org", () => {
    const where = getNrmSelectionWhere({
      nrmIds: [ALL_SELECTED_KEY],
      organizationId: ORG,
    });

    // The regression: a bare `{ organizationId }` here exported ~5k rows for a
    // ~2k-row index by pulling in deleted members and registered users.
    expect(where).toEqual({
      deletedAt: null,
      organizationId: ORG,
      userId: null,
      receivedInvites: { none: { status: InviteStatuses.PENDING } },
    });
    expect(where.id).toBeUndefined();
  });

  it("applies the active search on select-all", () => {
    const where = getNrmSelectionWhere({
      nrmIds: [ALL_SELECTED_KEY],
      organizationId: ORG,
      search: "john",
    });

    // Select-all means "every row matching the filters I currently have
    // applied", so the search branches must be exactly the index's — asserting
    // equality rather than a count keeps this pinned when a name column is
    // added to the search.
    expect(where.OR).toEqual(
      getNrmIndexWhere({ organizationId: ORG, search: "john" }).OR
    );
  });

  it("scopes explicit ids to non-deleted NRMs so untrusted ids can't widen the set", () => {
    const where = getNrmSelectionWhere({
      nrmIds: ["a", "b"],
      organizationId: ORG,
    });

    expect(where).toEqual({
      deletedAt: null,
      organizationId: ORG,
      userId: null,
      receivedInvites: { none: { status: InviteStatuses.PENDING } },
      id: { in: ["a", "b"] },
    });
  });

  it("ignores search when explicit ids are given (already post-filter)", () => {
    const where = getNrmSelectionWhere({
      nrmIds: ["a"],
      organizationId: ORG,
      search: "john",
    });

    expect(where.OR).toBeUndefined();
  });
});
