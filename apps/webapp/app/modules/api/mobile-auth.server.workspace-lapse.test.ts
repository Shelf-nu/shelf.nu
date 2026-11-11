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
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";

// why: importing the module loads `~/database/db.server`, which connects a
// real Prisma client at module load. The gate reads the membership row and the
// owner's tier; those two reads are the stubs the tests drive.
vi.mock("~/database/db.server", () => ({
  db: {
    userOrganization: { findUnique: vi.fn() },
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
