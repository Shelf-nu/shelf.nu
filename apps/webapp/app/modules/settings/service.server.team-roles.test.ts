// @vitest-environment node
/**
 * Team list role column: pins that a member's role label and role enum come
 * from the membership's effective (highest-rank) role, not its first array
 * element.
 *
 * @see {@link file://./service.server.ts} getPaginatedAndFilterableSettingUsers
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "~/database/db.server";
import { getPaginatedAndFilterableSettingUsers } from "./service.server";

// why: the service reads memberships through Prisma; the rows are the input
// under test, so they are supplied directly instead of seeded in a database
vi.mock("~/database/db.server", () => ({
  db: {
    userOrganization: { findMany: vi.fn(), count: vi.fn() },
  },
}));

// why: the per-page cookie is a transport concern unrelated to the role column
vi.mock("~/utils/cookies.server", () => ({
  updateCookieWithPerPage: vi.fn().mockResolvedValue({ perPage: 20 }),
}));

/** One team-list membership row, shaped like the service's Prisma select. */
function membership(roles: string[]) {
  return {
    roles,
    user: {
      id: "u-1",
      firstName: "Sam",
      lastName: "Lee",
      displayName: null,
      profilePicture: null,
      email: "sam@example.com",
      sso: false,
      teamMembers: [],
    },
  };
}

describe("team list role column", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.userOrganization.count).mockResolvedValue(1);
  });

  it.each([
    [["SELF_SERVICE", "ADMIN"], "ADMIN", "Administrator"],
    [["ADMIN", "OWNER"], "OWNER", "Owner"],
    [["BASE"], "BASE", "Base"],
  ])("%j shows %s", async (roles, roleEnum, label) => {
    vi.mocked(db.userOrganization.findMany).mockResolvedValue([
      membership(roles),
    ] as never);

    const { items } = await getPaginatedAndFilterableSettingUsers({
      organizationId: "org-1",
      request: new Request("http://localhost/settings/team/users"),
    });

    expect(items[0].roleEnum).toBe(roleEnum);
    expect(items[0].role).toBe(label);
  });
});
