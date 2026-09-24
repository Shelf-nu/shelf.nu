// @vitest-environment node
/**
 * Landing-order tests for the mobile `getUserOrganizations`.
 *
 * The companion has no workspace cookie: it opens `organizations[0]`, so the
 * ARRAY ORDER of this function's result is the wire contract for where a
 * mobile session lands. These tests pin that contract to the web resolver's
 * hierarchy (last-selected → personal for non-SSO → oldest first) and pin the
 * SSO rule that a personal workspace is never offered at all, so the two
 * clients cannot drift on "which workspace am I in?".
 *
 * `db.userOrganization.findMany` is mocked because the subject under test is
 * the ordering/filtering applied ON TOP of the query result; rows are fed in
 * base (oldest-first) order exactly as the query's `orderBy` yields them.
 *
 * @see {@link file://./mobile-auth.server.ts} — `getUserOrganizations`
 * @see {@link file://./../organization/context.server.ts} — the web hierarchy this mirrors
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import { getUserOrganizations } from "~/modules/api/mobile-auth.server";

// why: the subject under test is the ordering/filtering applied on top of the
// query result, so the query itself is the one boundary mocked. Rows are fed
// in the query's own (createdAt, id ascending) order.
vi.mock("~/database/db.server", () => ({
  db: {
    userOrganization: {
      findMany: vi.fn(),
    },
  },
}));

/** A findMany row in the shape the function selects. */
function row(
  id: string,
  type: "PERSONAL" | "TEAM",
  user: { sso: boolean; lastSelectedOrganizationId: string | null }
) {
  return {
    roles: ["ADMIN"],
    user,
    organization: {
      id,
      name: id,
      type,
      imageId: null,
      barcodesEnabled: false,
      auditsEnabled: false,
    },
  };
}

const findMany = vi.mocked(db.userOrganization.findMany);

beforeEach(() => {
  findMany.mockReset();
});

describe("getUserOrganizations landing order", () => {
  it("puts the last-selected workspace first", async () => {
    const user = { sso: false, lastSelectedOrganizationId: "team-b" };
    findMany.mockResolvedValue([
      row("personal", "PERSONAL", user),
      row("team-a", "TEAM", user),
      row("team-b", "TEAM", user),
    ] as never);

    const result = await getUserOrganizations("u1");

    expect(result.organizations.map((o) => o.id)).toEqual([
      "team-b",
      "personal",
      "team-a",
    ]);
    expect(result.lastSelectedOrganizationId).toBe("team-b");
  });

  it("falls back to the personal workspace for non-SSO users", async () => {
    const user = { sso: false, lastSelectedOrganizationId: null };
    findMany.mockResolvedValue([
      row("team-a", "TEAM", user),
      row("personal", "PERSONAL", user),
    ] as never);

    const result = await getUserOrganizations("u1");

    expect(result.organizations.map((o) => o.id)).toEqual([
      "personal",
      "team-a",
    ]);
    expect(result.lastSelectedOrganizationId).toBeNull();
  });

  it("never offers a personal workspace to an SSO user", async () => {
    const user = { sso: true, lastSelectedOrganizationId: null };
    findMany.mockResolvedValue([
      row("personal", "PERSONAL", user),
      row("team-a", "TEAM", user),
      row("team-b", "TEAM", user),
    ] as never);

    const result = await getUserOrganizations("u1");

    expect(result.organizations.map((o) => o.id)).toEqual(["team-a", "team-b"]);
  });

  it("nulls a last-selected id that points at a workspace the user cannot land in", async () => {
    // An SSO user whose last selection was their (now hidden) personal
    // workspace must not have index 0 decided by an unreachable id.
    const user = { sso: true, lastSelectedOrganizationId: "personal" };
    findMany.mockResolvedValue([
      row("personal", "PERSONAL", user),
      row("team-a", "TEAM", user),
    ] as never);

    const result = await getUserOrganizations("u1");

    expect(result.organizations.map((o) => o.id)).toEqual(["team-a"]);
    expect(result.lastSelectedOrganizationId).toBeNull();
  });

  it("keeps oldest-first order among otherwise equal workspaces", async () => {
    const user = { sso: false, lastSelectedOrganizationId: null };
    findMany.mockResolvedValue([
      row("team-old", "TEAM", user),
      row("team-new", "TEAM", user),
    ] as never);

    const result = await getUserOrganizations("u1");

    expect(result.organizations.map((o) => o.id)).toEqual([
      "team-old",
      "team-new",
    ]);
  });

  it("returns empty organizations for an SSO user with only a personal workspace", async () => {
    // The caller decides what "no visible workspaces" means for the app; this
    // function's contract is just an empty, honest list.
    const user = { sso: true, lastSelectedOrganizationId: null };
    findMany.mockResolvedValue([row("personal", "PERSONAL", user)] as never);

    const result = await getUserOrganizations("u1");

    expect(result.organizations).toEqual([]);
    expect(result.lastSelectedOrganizationId).toBeNull();
  });
});
