/**
 * SSO purchase gate.
 *
 * Pins the rule that non-SSO users always may purchase, and that SSO users may
 * only when they buy a Team plan and own a TEAM workspace.
 *
 * @see {@link file://./sso-purchase-gate.server.ts}
 */

import { beforeEach, describe, expect, it, vitest } from "vitest";
import { db } from "~/database/db.server";

import {
  assertUserMayPurchase,
  pricesOfferedTo,
  ssoUserMayPurchase,
} from "./sso-purchase-gate.server";

// why: the assertion is two small queries. Stubbing them lets each case state
// the user and workspace facts the database returns without a live database.
vitest.mock("~/database/db.server", () => ({
  db: {
    user: { findUniqueOrThrow: vitest.fn() },
    organization: { count: vitest.fn() },
  },
}));

const findUserMock = db.user.findUniqueOrThrow as ReturnType<typeof vitest.fn>;
const countMock = db.organization.count as ReturnType<typeof vitest.fn>;

beforeEach(() => {
  vitest.clearAllMocks();
});

describe("ssoUserMayPurchase", () => {
  it.each([["personal" as const], ["team" as const]])(
    "lets a non-SSO user purchase for target %s without owning a team workspace",
    (target) => {
      expect(
        ssoUserMayPurchase({ sso: false, ownsTeamWorkspace: false, target })
      ).toBe(true);
    }
  );

  it("lets an SSO team owner purchase a team plan", () => {
    expect(
      ssoUserMayPurchase({
        sso: true,
        ownsTeamWorkspace: true,
        target: "team",
      })
    ).toBe(true);
  });

  it("refuses a personal purchase to an SSO team owner", () => {
    expect(
      ssoUserMayPurchase({
        sso: true,
        ownsTeamWorkspace: true,
        target: "personal",
      })
    ).toBe(false);
  });

  it("refuses an SSO user who owns no team workspace", () => {
    expect(
      ssoUserMayPurchase({
        sso: true,
        ownsTeamWorkspace: false,
        target: "team",
      })
    ).toBe(false);
  });
});

/** Builds a price as the pricing table reads it: only the tier matters here. */
function price(id: string, shelfTier: string) {
  return { id, product: { metadata: { shelf_tier: shelfTier } } };
}

describe("pricesOfferedTo", () => {
  const prices = {
    month: [price("plus-month", "tier_1"), price("team-month", "tier_2")],
    year: [price("plus-year", "tier_1"), price("team-year", "tier_2")],
  };

  it("offers every plan to a non-SSO user", () => {
    expect(pricesOfferedTo({ prices, sso: false })).toEqual(prices);
  });

  it("never offers Plus to an SSO user, in either interval", () => {
    expect(pricesOfferedTo({ prices, sso: true })).toEqual({
      month: [price("team-month", "tier_2")],
      year: [price("team-year", "tier_2")],
    });
  });
});

describe("assertUserMayPurchase", () => {
  it.each([["personal" as const], ["team" as const]])(
    "resolves for a non-SSO user (target %s) without counting workspaces",
    async (target) => {
      findUserMock.mockResolvedValue({ sso: false });

      await expect(
        assertUserMayPurchase({ userId: "user-1", target })
      ).resolves.toBeUndefined();
      expect(countMock).not.toHaveBeenCalled();
    }
  );

  it("resolves for an SSO user who owns a TEAM workspace buying a team plan", async () => {
    findUserMock.mockResolvedValue({ sso: true });
    countMock.mockResolvedValue(1);

    await expect(
      assertUserMayPurchase({ userId: "user-1", target: "team" })
    ).resolves.toBeUndefined();
    expect(countMock).toHaveBeenCalledWith({
      where: { userId: "user-1", type: "TEAM" },
    });
  });

  it("rejects an SSO user who owns no TEAM workspace with a 403", async () => {
    findUserMock.mockResolvedValue({ sso: true });
    countMock.mockResolvedValue(0);

    await expect(
      assertUserMayPurchase({ userId: "user-1", target: "team" })
    ).rejects.toMatchObject({
      status: 403,
      title: "Purchases unavailable",
      message:
        "Billing for single sign-on accounts is managed by your workspace owner.",
    });
  });

  it("rejects a personal purchase by an SSO team owner without counting", async () => {
    findUserMock.mockResolvedValue({ sso: true });
    countMock.mockResolvedValue(1);

    await expect(
      assertUserMayPurchase({ userId: "user-1", target: "personal" })
    ).rejects.toMatchObject({ status: 403 });
    expect(countMock).not.toHaveBeenCalled();
  });
});
