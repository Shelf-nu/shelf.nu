/**
 * Tests for the mobile workspace lapse gate in `requireOrganizationAccess`.
 *
 * The companion app must refuse the same workspaces the web app shows as
 * "Workspace disabled" (`disabledTeamOrg` in `routes/_layout+/_layout.tsx`):
 * a TEAM workspace whose owner's tier is no longer a Team tier, and any
 * workspace a Shelf admin switched off. The gate and the shared
 * `teamTierLimitHasLapsed` rule run for real; only the membership row, which
 * carries the owner's tier, is stubbed.
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
// real Prisma client at module load. The gate reads one membership row; the
// owner and tier-limit reads are stubbed only so a test can prove they are
// never made.
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
const customTierLimitFind = vi.mocked(db.customTierLimit.findUniqueOrThrow);

const CALLER_ID = "user-member";
const OWNER_ID = "user-owner";
const ORG_ID = "org-1";

const CONTACT_OWNER = "Contact the workspace owner for more information.";
const CONTACT_SUPPORT = "Contact Shelf support for more information.";

/** A request from the companion acting in `ORG_ID`. */
function mobileRequest() {
  return new Request(`http://localhost/api/mobile/assets?orgId=${ORG_ID}`);
}

/** The membership row the gate selects, for a workspace and a caller. */
function membershipRow({
  type = "TEAM",
  workspaceDisabled = false,
  ownerId = OWNER_ID,
  ownerTierLimitId = "tier_2",
  callerSystemRoles = ["USER"],
}: {
  type?: "TEAM" | "PERSONAL";
  workspaceDisabled?: boolean;
  ownerId?: string;
  ownerTierLimitId?: "free" | "tier_1" | "tier_2" | null;
  callerSystemRoles?: string[];
} = {}) {
  return {
    organization: {
      type,
      userId: ownerId,
      workspaceDisabled,
      owner: { tier: { tierLimitId: ownerTierLimitId } },
    },
    user: { roles: callerSystemRoles.map((name) => ({ name })) },
  };
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
  it("allows an active TEAM workspace with one query: the membership read", async () => {
    givenMembership(membershipRow({ ownerTierLimitId: "tier_2" }));

    await expect(
      requireOrganizationAccess(mobileRequest(), CALLER_ID)
    ).resolves.toBe(ORG_ID);
    // The owner's tier rides on the membership row, so the gate makes no
    // query of its own on the hot path.
    expect(membershipFindUnique).toHaveBeenCalledTimes(1);
    expect(ownerFindUniqueOrThrow).not.toHaveBeenCalled();
    expect(customTierLimitFind).not.toHaveBeenCalled();
  });

  it.each(["free", "tier_1"] as const)(
    "refuses a TEAM workspace whose owner's tier lapsed to %s, telling a member to contact the owner",
    async (tierLimitId) => {
      givenMembership(membershipRow({ ownerTierLimitId: tierLimitId }));

      await expect(
        requireOrganizationAccess(mobileRequest(), CALLER_ID)
      ).rejects.toMatchObject({
        status: 403,
        message: `${MOBILE_INACTIVE_MESSAGES.lapsed.workspace} ${CONTACT_OWNER}`,
      });
    }
  );

  it("allows a TEAM workspace whose owner has no tier limit (custom tier)", async () => {
    givenMembership(membershipRow({ ownerTierLimitId: null }));

    await expect(
      requireOrganizationAccess(mobileRequest(), CALLER_ID)
    ).resolves.toBe(ORG_ID);
  });

  it("refuses a lapsed TEAM workspace even when the request URL names account-details", async () => {
    givenMembership(membershipRow({ ownerTierLimitId: "free" }));

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
    givenMembership(
      membershipRow({ ownerId: CALLER_ID, ownerTierLimitId: "free" })
    );

    await expect(
      requireOrganizationAccess(mobileRequest(), CALLER_ID)
    ).rejects.toMatchObject({
      status: 403,
      message: MOBILE_INACTIVE_MESSAGES.lapsed.workspace,
    });
  });

  it.each([
    ["a member", OWNER_ID],
    ["the owner", CALLER_ID],
  ])(
    "refuses a workspace a Shelf admin disabled, sending %s to Shelf support",
    async (_who, ownerId) => {
      givenMembership(
        membershipRow({
          workspaceDisabled: true,
          ownerId,
          ownerTierLimitId: "tier_2",
        })
      );

      // Only Shelf staff can lift the switch, so nobody is sent to the owner
      // and the subscription is not blamed.
      await expect(
        requireOrganizationAccess(mobileRequest(), CALLER_ID)
      ).rejects.toMatchObject({
        status: 403,
        message: `${MOBILE_INACTIVE_MESSAGES.disabled.workspace} ${CONTACT_SUPPORT}`,
      });
    }
  );

  it("refuses a PERSONAL workspace a Shelf admin disabled", async () => {
    givenMembership(
      membershipRow({
        type: "PERSONAL",
        workspaceDisabled: true,
        ownerId: CALLER_ID,
      })
    );

    await expect(
      requireOrganizationAccess(mobileRequest(), CALLER_ID)
    ).rejects.toMatchObject({
      status: 403,
      message: `${MOBILE_INACTIVE_MESSAGES.disabled.workspace} ${CONTACT_SUPPORT}`,
    });
  });

  it("never refuses a personal workspace for its owner's free tier", async () => {
    givenMembership(
      membershipRow({
        type: "PERSONAL",
        ownerId: CALLER_ID,
        ownerTierLimitId: "free",
      })
    );

    await expect(
      requireOrganizationAccess(mobileRequest(), CALLER_ID)
    ).resolves.toBe(ORG_ID);
  });

  it("lets a Shelf admin into a lapsed TEAM workspace, as the web does", async () => {
    givenMembership(
      membershipRow({
        callerSystemRoles: ["USER", "ADMIN"],
        ownerTierLimitId: "free",
      })
    );

    await expect(
      requireOrganizationAccess(mobileRequest(), CALLER_ID)
    ).resolves.toBe(ORG_ID);
  });

  it("lets a Shelf admin into a workspace a Shelf admin disabled, as the web does", async () => {
    givenMembership(
      membershipRow({
        callerSystemRoles: ["USER", "ADMIN"],
        workspaceDisabled: true,
      })
    );

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
    givenMembership(membershipRow({ ownerTierLimitId: "tier_2" }));
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

    givenMembership(membershipRow({ ownerTierLimitId: "free" }));
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
        message: `${MOBILE_INACTIVE_MESSAGES.lapsed.code} ${CONTACT_OWNER}`,
      },
    });
  });
});

describe("requireOrganizationAccess with premium features off (self-hosted)", () => {
  it("lets a TEAM workspace through whatever the owner's tier", async () => {
    // why: `premiumIsEnabled` is read from the config when `stripe.server`
    // loads, so the module graph is reloaded with premium switched off. The
    // reset runs in `finally` so a failed assertion cannot leave premium off
    // for the tests after this one.
    vi.resetModules();
    vi.doMock("~/config/shelf.config", async (importOriginal) => {
      const actual = await importOriginal<{ config: ShelfConfig }>();
      return {
        ...actual,
        config: { ...actual.config, enablePremiumFeatures: false },
      };
    });
    try {
      const { db: freshDb } = await import("~/database/db.server");
      const { requireOrganizationAccess: gate } = await import(
        "~/modules/api/mobile-auth.server"
      );
      vi.mocked(freshDb.userOrganization.findUnique).mockResolvedValue(
        membershipRow({ ownerTierLimitId: "free" }) as never
      );

      await expect(gate(mobileRequest(), CALLER_ID)).resolves.toBe(ORG_ID);
    } finally {
      vi.doUnmock("~/config/shelf.config");
      vi.resetModules();
    }
  });
});
