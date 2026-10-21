/**
 * SSO purchase gate.
 *
 * Pins the rule that non-SSO users always may purchase, and that SSO users may
 * only when they own a TEAM workspace and the plan is not `tier_1`.
 *
 * @see {@link file://./sso-purchase-gate.server.ts}
 */

import { beforeEach, describe, expect, it, vitest } from "vitest";
import { db } from "~/database/db.server";

import { PURCHASES_UNAVAILABLE_MESSAGE } from "./purchase-copy";
import {
  assertUserMayPurchase,
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
  it.each([["tier_1" as const], ["tier_2" as const], [undefined]])(
    "lets a non-SSO user purchase (tier %s) without owning a team workspace",
    (shelfTier) => {
      expect(
        ssoUserMayPurchase({
          sso: false,
          ownsTeamWorkspace: false,
          shelfTier,
        })
      ).toBe(true);
    }
  );

  it("lets an SSO team owner purchase tier_2", () => {
    expect(
      ssoUserMayPurchase({
        sso: true,
        ownsTeamWorkspace: true,
        shelfTier: "tier_2",
      })
    ).toBe(true);
  });

  it("lets an SSO team owner purchase when the tier is unspecified", () => {
    expect(ssoUserMayPurchase({ sso: true, ownsTeamWorkspace: true })).toBe(
      true
    );
  });

  it("refuses tier_1 to an SSO team owner", () => {
    expect(
      ssoUserMayPurchase({
        sso: true,
        ownsTeamWorkspace: true,
        shelfTier: "tier_1",
      })
    ).toBe(false);
  });

  it("refuses an SSO user who owns no team workspace", () => {
    expect(
      ssoUserMayPurchase({
        sso: true,
        ownsTeamWorkspace: false,
        shelfTier: "tier_2",
      })
    ).toBe(false);
  });
});

describe("assertUserMayPurchase", () => {
  it("resolves for a non-SSO user without counting workspaces", async () => {
    findUserMock.mockResolvedValue({ sso: false });

    await expect(
      assertUserMayPurchase({ userId: "user-1" })
    ).resolves.toBeUndefined();
    expect(countMock).not.toHaveBeenCalled();
  });

  it("resolves for an SSO user who owns a TEAM workspace", async () => {
    findUserMock.mockResolvedValue({ sso: true });
    countMock.mockResolvedValue(1);

    await expect(
      assertUserMayPurchase({ userId: "user-1", shelfTier: "tier_2" })
    ).resolves.toBeUndefined();
    expect(countMock).toHaveBeenCalledWith({
      where: { userId: "user-1", type: "TEAM" },
    });
  });

  it("rejects an SSO user who owns no TEAM workspace with a 403", async () => {
    findUserMock.mockResolvedValue({ sso: true });
    countMock.mockResolvedValue(0);

    await expect(
      assertUserMayPurchase({ userId: "user-1", shelfTier: "tier_2" })
    ).rejects.toMatchObject({
      status: 403,
      title: "Purchases unavailable",
      message: PURCHASES_UNAVAILABLE_MESSAGE,
    });
  });
});
