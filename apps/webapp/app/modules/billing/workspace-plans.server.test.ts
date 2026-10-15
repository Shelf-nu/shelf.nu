/**
 * Workspace plans for the account subscription page.
 *
 * Pins the rule that a workspace's plan is its owner's tier, that the payer is
 * named by display name, and that the current workspace leads the table.
 *
 * @see {@link file://./workspace-plans.server.ts}
 */

import { beforeEach, describe, expect, it, vitest } from "vitest";
import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";

import { getWorkspacePlansForUser } from "./workspace-plans.server";

// why: the service is one membership query plus a pure mapping. Stubbing
// `findMany` lets each case state the memberships the database returns and
// assert on the rows built from them, without a live database.
vitest.mock("~/database/db.server", () => ({
  db: { userOrganization: { findMany: vitest.fn() } },
}));

const findManyMock = db.userOrganization.findMany as ReturnType<
  typeof vitest.fn
>;

const USER_ID = "user-me";

type OwnerOverrides = {
  id?: string;
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  tierId?: "free" | "tier_1" | "tier_2" | "custom";
  customTierLimit?: { isEnterprise: boolean } | null;
};

/** Builds one membership row as the query's `select` returns it. */
function membership({
  orgId,
  name = "Workspace",
  type = "TEAM",
  roles = ["ADMIN"],
  owner = {},
  sso = false,
}: {
  orgId: string;
  name?: string;
  type?: "TEAM" | "PERSONAL";
  roles?: string[];
  owner?: OwnerOverrides;
  /** Whether the member (the signed-in user) is an SSO user. */
  sso?: boolean;
}) {
  const ownerRow = {
    id: "user-owner",
    firstName: "Sam",
    lastName: "Legal",
    displayName: null,
    tierId: "free",
    customTierLimit: null,
    ...owner,
  };
  return {
    roles,
    user: { sso },
    organization: {
      id: orgId,
      name,
      type,
      imageId: null,
      userId: ownerRow.id,
      owner: ownerRow,
    },
  };
}

beforeEach(() => {
  vitest.clearAllMocks();
});

describe("getWorkspacePlansForUser", () => {
  it("leaves out an SSO user's personal workspace, which they cannot open", async () => {
    findManyMock.mockResolvedValue([
      membership({
        orgId: "personal",
        type: "PERSONAL",
        roles: ["OWNER"],
        owner: { id: USER_ID },
        sso: true,
      }),
      membership({ orgId: "team", sso: true }),
    ]);

    const rows = await getWorkspacePlansForUser({
      userId: USER_ID,
      currentOrganizationId: "team",
    });

    expect(rows.map((r) => r.organizationId)).toEqual(["team"]);
  });

  it("labels the role by the most privileged one the membership holds", async () => {
    findManyMock.mockResolvedValue([
      membership({ orgId: "team", roles: ["SELF_SERVICE", "ADMIN"] }),
    ]);

    const [row] = await getWorkspacePlansForUser({
      userId: USER_ID,
      currentOrganizationId: "team",
    });

    expect(row.roleLabel).toBe("Administrator");
  });

  it("queries only the user's memberships and selects the owner's display name and tier", async () => {
    findManyMock.mockResolvedValue([]);

    await getWorkspacePlansForUser({
      userId: USER_ID,
      currentOrganizationId: "org-1",
    });

    expect(findManyMock).toHaveBeenCalledTimes(1);
    const args = findManyMock.mock.calls[0][0];
    expect(args.where).toEqual({ userId: USER_ID });
    expect(args.select.organization.select.owner.select).toMatchObject({
      displayName: true,
      firstName: true,
      lastName: true,
      tierId: true,
      customTierLimit: { select: { isEnterprise: true } },
    });
  });

  it("marks a workspace the user owns as paid by them, without a name", async () => {
    findManyMock.mockResolvedValue([
      membership({
        orgId: "mine",
        type: "PERSONAL",
        roles: ["OWNER"],
        owner: { id: USER_ID, tierId: "tier_1" },
      }),
    ]);

    const [row] = await getWorkspacePlansForUser({
      userId: USER_ID,
      currentOrganizationId: "mine",
    });

    expect(row).toEqual({
      organizationId: "mine",
      // Personal workspaces are labelled by kind, not by their stored name.
      name: "Personal workspace",
      type: "PERSONAL",
      imageId: null,
      isCurrent: true,
      roleLabel: "Owner",
      plan: { tierId: "tier_1", label: "Plus" },
      paidBy: { isYou: true, name: "" },
    });
  });

  it("takes the plan from the owner's tier and names the owner by display name", async () => {
    findManyMock.mockResolvedValue([
      membership({
        orgId: "team",
        roles: ["ADMIN"],
        owner: { tierId: "tier_2", displayName: "Sammy" },
      }),
    ]);

    const [row] = await getWorkspacePlansForUser({
      userId: USER_ID,
      currentOrganizationId: "team",
    });

    // The member's own tier plays no part: an invited admin on a Free
    // account still sees the Team plan the owner pays for.
    expect(row.plan).toEqual({ tierId: "tier_2", label: "Team" });
    expect(row.roleLabel).toBe("Administrator");
    expect(row.paidBy).toEqual({ isYou: false, name: "Sammy" });
  });

  it("falls back to the owner's legal name when no display name is set", async () => {
    findManyMock.mockResolvedValue([membership({ orgId: "team" })]);

    const [row] = await getWorkspacePlansForUser({
      userId: USER_ID,
      currentOrganizationId: "team",
    });

    expect(row.paidBy).toEqual({ isYou: false, name: "Sam Legal" });
  });

  it.each([
    [{ isEnterprise: true }, "Enterprise"],
    [{ isEnterprise: false }, "Custom"],
    [null, "Custom"],
  ] as const)(
    "labels a custom-tier owner with customTierLimit %j as %s",
    async (customTierLimit, label) => {
      findManyMock.mockResolvedValue([
        membership({
          orgId: "team",
          owner: { tierId: "custom", customTierLimit },
        }),
      ]);

      const [row] = await getWorkspacePlansForUser({
        userId: USER_ID,
        currentOrganizationId: "team",
      });

      expect(row.plan).toEqual({ tierId: "custom", label });
    }
  );

  it("lists the current workspace first, then Team before Personal, then by name", async () => {
    findManyMock.mockResolvedValue([
      membership({
        orgId: "personal",
        name: "Alpha",
        type: "PERSONAL",
        roles: ["OWNER"],
        owner: { id: USER_ID },
      }),
      membership({ orgId: "team-z", name: "Zeta" }),
      membership({ orgId: "team-b", name: "Beta" }),
      membership({ orgId: "current", name: "Omega", roles: ["BASE"] }),
    ]);

    const rows = await getWorkspacePlansForUser({
      userId: USER_ID,
      currentOrganizationId: "current",
    });

    expect(rows.map((r) => r.organizationId)).toEqual([
      "current",
      "team-b",
      "team-z",
      "personal",
    ]);
    expect(rows[0]).toMatchObject({ isCurrent: true, roleLabel: "Base" });
    expect(rows.slice(1).every((r) => !r.isCurrent)).toBe(true);
  });

  it("wraps a database failure in a ShelfError", async () => {
    findManyMock.mockRejectedValue(new Error("connection reset"));

    const promise = getWorkspacePlansForUser({
      userId: USER_ID,
      currentOrganizationId: "org-1",
    });

    await expect(promise).rejects.toThrow(ShelfError);
    await expect(promise).rejects.toMatchObject({
      label: "Subscription",
      message: "Something went wrong while loading your workspaces' plans.",
      additionalData: { userId: USER_ID },
    });
  });
});
