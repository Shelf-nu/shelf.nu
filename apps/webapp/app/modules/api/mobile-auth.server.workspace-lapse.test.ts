/**
 * Tests for the mobile workspace lapse gate in `requireOrganizationAccess`.
 *
 * The companion app must refuse the same workspaces the web app shows as
 * "Workspace disabled" (`disabledTeamOrg` in `routes/_layout+/_layout.tsx`):
 * a TEAM workspace whose owner's tier is no longer a Team tier, and any
 * workspace a Shelf admin switched off. The real `disabledTeamOrg` and tier
 * lookup run here; only the database rows are stubbed.
 *
 * @see {@link file://./mobile-auth.server.ts}
 * @see {@link file://./../../utils/stripe.server.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { config as shelfConfig } from "~/config/shelf.config";
import { db } from "~/database/db.server";
import {
  MOBILE_INACTIVE_MESSAGES,
  getMobileWorkspaceAccess,
  getMobileWorkspaceStates,
  mobileScanErrorBody,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { ShelfError, makeShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";

// why: importing the module loads `~/database/db.server`, which connects a
// real Prisma client at module load. The gate reads the membership row and the
// owner's tier; those two reads are the stubs the tests drive.
vi.mock("~/database/db.server", () => ({
  db: {
    userOrganization: { findUnique: vi.fn(), findMany: vi.fn() },
    user: { findUniqueOrThrow: vi.fn() },
    customTierLimit: { findUniqueOrThrow: vi.fn() },
  },
}));

// why: `stripe.server` constructs the Stripe SDK client at module load; no
// Stripe call is part of the gate.
vi.mock("stripe", () => ({
  default: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

// why: a failed state read is logged; the tests assert that it is without
// writing to the test output.
vi.mock("~/utils/logger", () => ({ Logger: { error: vi.fn() } }));

// why: `mobile-auth.server` loads the Supabase admin client, which needs env
// and network wiring; the gate never calls it.
vi.mock("~/integrations/supabase/client", () => ({
  getSupabaseAdmin: vi.fn(),
}));

type ShelfConfig = typeof shelfConfig;

const membershipFindUnique = vi.mocked(db.userOrganization.findUnique);
const ownerFindUniqueOrThrow = vi.mocked(db.user.findUniqueOrThrow);

const CALLER_ID = "user-member";
const OWNER_ID = "user-owner";
const ORG_ID = "org-1";

/** A request from the companion acting in `ORG_ID`. */
function mobileRequest() {
  return new Request(`http://localhost/api/mobile/assets?orgId=${ORG_ID}`);
}

/** The membership row the gate selects, for a workspace and a caller. */
function membershipRow({
  type = "TEAM",
  workspaceDisabled = false,
  ownerId = OWNER_ID,
  callerSystemRoles = ["USER"],
}: {
  type?: "TEAM" | "PERSONAL";
  workspaceDisabled?: boolean;
  ownerId?: string;
  callerSystemRoles?: string[];
} = {}) {
  return {
    id: "membership-1",
    organization: {
      id: ORG_ID,
      type,
      name: "Workspace",
      imageId: null,
      userId: ownerId,
      workspaceDisabled,
    },
    user: { roles: callerSystemRoles.map((name) => ({ name })) },
  };
}

/** Sets the workspace owner's tier, as `getUserTierLimit` reads it. */
function ownerTier(tierId: "free" | "tier_1" | "tier_2") {
  // why: cast, the tier lookup selects a narrow shape, not the full User row.
  ownerFindUniqueOrThrow.mockResolvedValue({
    tier: { id: tierId, tierLimit: { id: tierId } },
  } as never);
}

/** Sets the membership row the gate reads. */
function givenMembership(row: ReturnType<typeof membershipRow> | null) {
  // why: cast, the gate selects a narrow shape, not the full row.
  membershipFindUnique.mockResolvedValue(row as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requireOrganizationAccess workspace lapse gate", () => {
  it("allows a TEAM workspace whose owner is on the Team tier", async () => {
    givenMembership(membershipRow());
    ownerTier("tier_2");

    await expect(
      requireOrganizationAccess(mobileRequest(), CALLER_ID)
    ).resolves.toBe(ORG_ID);
    expect(ownerFindUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: OWNER_ID } })
    );
  });

  it.each(["free", "tier_1"] as const)(
    "refuses a TEAM workspace whose owner's tier lapsed to %s, telling a member to contact the owner",
    async (tierId) => {
      givenMembership(membershipRow());
      ownerTier(tierId);

      await expect(
        requireOrganizationAccess(mobileRequest(), CALLER_ID)
      ).rejects.toMatchObject({
        status: 403,
        message: `${MOBILE_INACTIVE_MESSAGES.lapsed.workspace} Contact the workspace owner for more information.`,
      });
    }
  );

  it("refuses a lapsed TEAM workspace even when the request URL names account-details", async () => {
    givenMembership(membershipRow());
    ownerTier("free");

    // The web exempts its account-details pages by URL; a mobile request URL
    // is caller-controlled and must not reach that exemption.
    const request = new Request(
      `http://localhost/api/mobile/account-details/assets?orgId=${ORG_ID}&x=account-details`
    );

    await expect(
      requireOrganizationAccess(request, CALLER_ID)
    ).rejects.toMatchObject({ status: 403 });
  });

  it("refuses the owner of a lapsed TEAM workspace without pointing them to themselves", async () => {
    givenMembership(membershipRow({ ownerId: CALLER_ID }));
    ownerTier("free");

    await expect(
      requireOrganizationAccess(mobileRequest(), CALLER_ID)
    ).rejects.toMatchObject({
      status: 403,
      message: MOBILE_INACTIVE_MESSAGES.lapsed.workspace,
    });
  });

  it("refuses a workspace a Shelf admin disabled, whatever the owner's tier, without blaming the subscription", async () => {
    givenMembership(membershipRow({ workspaceDisabled: true }));
    ownerTier("tier_2");

    await expect(
      requireOrganizationAccess(mobileRequest(), CALLER_ID)
    ).rejects.toMatchObject({
      status: 403,
      message: `${MOBILE_INACTIVE_MESSAGES.disabled.workspace} Contact the workspace owner for more information.`,
    });
  });

  it("never refuses a personal workspace for its owner's free tier", async () => {
    givenMembership(membershipRow({ type: "PERSONAL", ownerId: CALLER_ID }));
    ownerTier("free");

    await expect(
      requireOrganizationAccess(mobileRequest(), CALLER_ID)
    ).resolves.toBe(ORG_ID);
    // The tier only decides TEAM workspaces, so it is not read at all.
    expect(ownerFindUniqueOrThrow).not.toHaveBeenCalled();
  });

  it("lets a Shelf admin into a lapsed TEAM workspace, as the web does", async () => {
    givenMembership(membershipRow({ callerSystemRoles: ["USER", "ADMIN"] }));
    ownerTier("free");

    await expect(
      requireOrganizationAccess(mobileRequest(), CALLER_ID)
    ).resolves.toBe(ORG_ID);
  });

  it("still refuses a caller who is not a member", async () => {
    givenMembership(null);

    await expect(
      requireOrganizationAccess(mobileRequest(), CALLER_ID)
    ).rejects.toMatchObject({
      status: 403,
      message: "You don't have access to this organization",
    });
  });
});

describe("getMobileWorkspaceAccess", () => {
  it("answers active, not-member, and inactive with the 403 for a scanned code's workspace", async () => {
    givenMembership(membershipRow());
    ownerTier("tier_2");
    await expect(
      getMobileWorkspaceAccess({
        userId: CALLER_ID,
        organizationId: ORG_ID,
        reason: "code",
      })
    ).resolves.toEqual({ access: "active" });

    givenMembership(null);
    await expect(
      getMobileWorkspaceAccess({
        userId: CALLER_ID,
        organizationId: ORG_ID,
        reason: "code",
      })
    ).resolves.toEqual({ access: "not-member" });

    givenMembership(membershipRow());
    ownerTier("free");
    const answer = await getMobileWorkspaceAccess({
      userId: CALLER_ID,
      organizationId: ORG_ID,
      reason: "code",
    });
    expect(answer.access).toBe("inactive");
    // A scanned code may belong to a workspace other than the app's own, so
    // the message names the code's workspace.
    expect(answer).toMatchObject({
      error: {
        status: 403,
        message: `${MOBILE_INACTIVE_MESSAGES.lapsed.code} Contact the workspace owner for more information.`,
      },
    });
  });
});

describe("getMobileWorkspaceStates", () => {
  /** A membership row as the state reader selects it. */
  function stateRow({
    id,
    type = "TEAM",
    ownerId = OWNER_ID,
    workspaceDisabled = false,
    callerSystemRoles = ["USER"],
  }: {
    id: string;
    type?: "TEAM" | "PERSONAL";
    ownerId?: string;
    workspaceDisabled?: boolean;
    callerSystemRoles?: string[];
  }) {
    return {
      organization: {
        id,
        type,
        name: id,
        imageId: null,
        userId: ownerId,
        workspaceDisabled,
      },
      user: { roles: callerSystemRoles.map((name) => ({ name })) },
    };
  }

  /** Gives each owner a tier, by owner id, as `getUserTierLimit` reads it. */
  function ownerTiers(tiers: Record<string, "free" | "tier_1" | "tier_2">) {
    ownerFindUniqueOrThrow.mockImplementation(((args: {
      where: { id: string };
    }) => {
      const tierId = tiers[args.where.id];
      return Promise.resolve({
        tier: { id: tierId, tierLimit: { id: tierId } },
      });
    }) as never);
  }

  it("marks each workspace active or inactive by the same rules as the gate", async () => {
    vi.mocked(db.userOrganization.findMany).mockResolvedValue([
      stateRow({ id: "team-paid", ownerId: "owner-paid" }),
      stateRow({ id: "team-lapsed", ownerId: "owner-lapsed" }),
      stateRow({ id: "team-own-lapsed", ownerId: CALLER_ID }),
      stateRow({
        id: "team-disabled",
        ownerId: "owner-paid",
        workspaceDisabled: true,
      }),
      stateRow({ id: "personal", type: "PERSONAL", ownerId: CALLER_ID }),
    ] as never);
    ownerTiers({
      "owner-paid": "tier_2",
      "owner-lapsed": "free",
      [CALLER_ID]: "tier_1",
    });

    const states = await getMobileWorkspaceStates({
      userId: CALLER_ID,
      organizationIds: [
        "team-paid",
        "team-lapsed",
        "team-own-lapsed",
        "team-disabled",
        "personal",
      ],
    });

    expect(Object.fromEntries(states)).toEqual({
      "team-paid": {
        inactive: false,
        inactiveReason: null,
        inactiveMessage: null,
      },
      "team-lapsed": {
        inactive: true,
        inactiveReason: "lapsed",
        inactiveMessage: `${MOBILE_INACTIVE_MESSAGES.lapsed.workspace} Contact the workspace owner for more information.`,
      },
      // The owner is not told to contact themselves.
      "team-own-lapsed": {
        inactive: true,
        inactiveReason: "lapsed",
        inactiveMessage: MOBILE_INACTIVE_MESSAGES.lapsed.workspace,
      },
      "team-disabled": {
        inactive: true,
        inactiveReason: "disabled",
        inactiveMessage: `${MOBILE_INACTIVE_MESSAGES.disabled.workspace} Contact the workspace owner for more information.`,
      },
      // A personal workspace is never refused for its owner's tier.
      personal: {
        inactive: false,
        inactiveReason: null,
        inactiveMessage: null,
      },
    });
    expect(db.userOrganization.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: CALLER_ID,
          organizationId: {
            in: [
              "team-paid",
              "team-lapsed",
              "team-own-lapsed",
              "team-disabled",
              "personal",
            ],
          },
        },
      })
    );
  });

  it("reports a lapsed workspace as active for a Shelf admin, as the gate lets them in", async () => {
    vi.mocked(db.userOrganization.findMany).mockResolvedValue([
      stateRow({ id: "team-lapsed", callerSystemRoles: ["ADMIN"] }),
    ] as never);
    ownerTiers({ [OWNER_ID]: "free" });

    const states = await getMobileWorkspaceStates({
      userId: CALLER_ID,
      organizationIds: ["team-lapsed"],
    });

    expect(states.get("team-lapsed")?.inactive).toBe(false);
  });

  it("reads each owner's tier once, however many of their workspaces the caller is in", async () => {
    vi.mocked(db.userOrganization.findMany).mockResolvedValue([
      stateRow({ id: "team-a", ownerId: "owner-shared" }),
      stateRow({ id: "team-b", ownerId: "owner-shared" }),
      stateRow({ id: "team-c", ownerId: "owner-other" }),
    ] as never);
    ownerTiers({ "owner-shared": "free", "owner-other": "tier_2" });

    const states = await getMobileWorkspaceStates({
      userId: CALLER_ID,
      organizationIds: ["team-a", "team-b", "team-c"],
    });

    expect(ownerFindUniqueOrThrow).toHaveBeenCalledTimes(2);
    expect(
      ["team-a", "team-b", "team-c"].map((id) => states.get(id)?.inactive)
    ).toEqual([true, true, false]);
  });

  it("leaves out only the workspace whose owner's tier cannot be read", async () => {
    vi.mocked(db.userOrganization.findMany).mockResolvedValue([
      stateRow({ id: "team-broken", ownerId: "owner-broken" }),
      stateRow({
        id: "team-disabled",
        ownerId: "owner-broken",
        workspaceDisabled: true,
      }),
      stateRow({ id: "team-paid", ownerId: "owner-paid" }),
    ] as never);
    ownerFindUniqueOrThrow.mockImplementation(((args: {
      where: { id: string };
    }) =>
      args.where.id === "owner-broken"
        ? Promise.reject(new Error("User tier not found"))
        : Promise.resolve({
            tier: { id: "tier_2", tierLimit: { id: "tier_2" } },
          })) as never);

    const states = await getMobileWorkspaceStates({
      userId: CALLER_ID,
      organizationIds: ["team-broken", "team-disabled", "team-paid"],
    });

    expect(states.has("team-broken")).toBe(false);
    // A switched-off workspace needs no tier read, so it keeps its answer.
    expect(states.get("team-disabled")?.inactiveReason).toBe("disabled");
    expect(states.get("team-paid")?.inactive).toBe(false);
    expect(Logger.error).toHaveBeenCalledTimes(1);
  });

  it("reads nothing for a caller with no workspace", async () => {
    const states = await getMobileWorkspaceStates({
      userId: CALLER_ID,
      organizationIds: [],
    });

    expect(states.size).toBe(0);
    expect(db.userOrganization.findMany).not.toHaveBeenCalled();
  });
});

describe("mobileScanErrorBody", () => {
  it("tags the inactive-workspace refusal, even once makeShelfError has wrapped it", async () => {
    givenMembership(membershipRow());
    ownerTier("free");
    const answer = await getMobileWorkspaceAccess({
      userId: CALLER_ID,
      organizationId: ORG_ID,
      reason: "code",
    });
    if (answer.access !== "inactive") throw new Error("expected inactive");

    expect(mobileScanErrorBody(makeShelfError(answer.error))).toEqual({
      message: answer.error.message,
      reason: "workspace_inactive",
    });
  });

  it("sends the message alone for any other 403", () => {
    const notMember = new ShelfError({
      cause: null,
      message: "You don't have access to this organization",
      label: "Auth",
      status: 403,
    });

    expect(mobileScanErrorBody(makeShelfError(notMember))).toEqual({
      message: "You don't have access to this organization",
    });
  });
});

describe("requireOrganizationAccess with premium features off (self-hosted)", () => {
  it("lets a TEAM workspace through whatever the owner's tier, without reading it", async () => {
    // why: `premiumIsEnabled` is read from the config when `stripe.server`
    // loads, so the module graph is reloaded with premium switched off.
    vi.resetModules();
    vi.doMock("~/config/shelf.config", async (importOriginal) => {
      const actual = await importOriginal<{ config: ShelfConfig }>();
      return {
        ...actual,
        config: { ...actual.config, enablePremiumFeatures: false },
      };
    });
    const { db: freshDb } = await import("~/database/db.server");
    const { requireOrganizationAccess: gate } = await import(
      "~/modules/api/mobile-auth.server"
    );
    vi.mocked(freshDb.userOrganization.findUnique).mockResolvedValue(
      membershipRow() as never
    );
    vi.mocked(freshDb.user.findUniqueOrThrow).mockResolvedValue({
      tier: { id: "free", tierLimit: { id: "free" } },
    } as never);

    await expect(gate(mobileRequest(), CALLER_ID)).resolves.toBe(ORG_ID);
    expect(freshDb.user.findUniqueOrThrow).not.toHaveBeenCalled();

    vi.doUnmock("~/config/shelf.config");
    vi.resetModules();
  });
});
