// @vitest-environment node
/**
 * Tests for the calendar-subscription service
 * (`~/modules/calendar-subscription/service.server`).
 *
 * Two things live here. `resolveCalendarVisibility` decides how much of a
 * workspace's bookings and custody a role may see in the feed, which is the
 * only place that policy is expressed. And the feed token: a per-membership
 * secret that anyone holding the URL can read with, so the cases below cover
 * how it is first set, rotated and revoked — including two callers setting it at
 * once, where the loser must report the token that persisted rather than the one
 * it generated.
 *
 * @see {@link file://./service.server.ts}
 */
import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "~/database/db.server";
import {
  assertCanUseBookings,
  canUseBookings,
} from "~/utils/subscription.server";
import {
  assertMemberCanManageCalendar,
  buildCalendarFeedUrl,
  getCalendarFeedContext,
  getMemberCalendarFeedUrl,
  getMemberCalendarFeeds,
  getOrCreateCalendarToken,
  resolveCalendarVisibility,
  revokeCalendarToken,
  rotateCalendarToken,
} from "./service.server";

// why: exercise token lifecycle + visibility logic without a real database
vi.mock("~/database/db.server", () => ({
  db: {
    userOrganization: {
      findUnique: vi.fn(),
      update: vi.fn(),
      // why: the first-set is conditional — it writes only while the token is
      // still null — so the get-or-create path goes through updateMany, whose
      // count says whether this caller or a concurrent one won.
      updateMany: vi.fn(),
    },
    user: { findUnique: vi.fn() },
  },
}));

// why: drive the workspace-entitlement gate deterministically, independent of
// env-derived premium flags (premiumIsEnabled). Defaults to entitled; tests
// that assert the gate override the return value explicitly.
vi.mock("~/utils/subscription.server", () => ({
  canUseBookings: vi.fn(() => true),
  assertCanUseBookings: vi.fn(),
}));

const USER_ID = "user-1";
const ORG_ID = "org-1";
const WHERE = {
  userId_organizationId: { userId: USER_ID, organizationId: ORG_ID },
};
/** `updateMany` takes plain columns, not the compound-unique wrapper. */
const WHERE_FLAT = { userId: USER_ID, organizationId: ORG_ID };

const allVisible = {
  selfServiceCanSeeBookings: true,
  baseUserCanSeeBookings: true,
  selfServiceCanSeeCustody: true,
  baseUserCanSeeCustody: true,
};
const noneVisible = {
  selfServiceCanSeeBookings: false,
  baseUserCanSeeBookings: false,
  selfServiceCanSeeCustody: false,
  baseUserCanSeeCustody: false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveCalendarVisibility", () => {
  it("lets OWNER/ADMIN see all bookings and custody regardless of org flags", () => {
    for (const role of [OrganizationRoles.OWNER, OrganizationRoles.ADMIN]) {
      expect(
        resolveCalendarVisibility({ roles: [role], organization: noneVisible })
      ).toEqual({ canSeeAllBookings: true, canSeeAllCustody: true });
    }
  });

  it("restricts SELF_SERVICE unless the workspace grants visibility", () => {
    expect(
      resolveCalendarVisibility({
        roles: [OrganizationRoles.SELF_SERVICE],
        organization: noneVisible,
      })
    ).toEqual({ canSeeAllBookings: false, canSeeAllCustody: false });

    expect(
      resolveCalendarVisibility({
        roles: [OrganizationRoles.SELF_SERVICE],
        organization: allVisible,
      })
    ).toEqual({ canSeeAllBookings: true, canSeeAllCustody: true });
  });

  it("restricts BASE unless the workspace grants visibility", () => {
    expect(
      resolveCalendarVisibility({
        roles: [OrganizationRoles.BASE],
        organization: noneVisible,
      })
    ).toEqual({ canSeeAllBookings: false, canSeeAllCustody: false });

    expect(
      resolveCalendarVisibility({
        roles: [OrganizationRoles.BASE],
        organization: allVisible,
      })
    ).toEqual({ canSeeAllBookings: true, canSeeAllCustody: true });
  });

  it("honors the booking and custody flags independently", () => {
    expect(
      resolveCalendarVisibility({
        roles: [OrganizationRoles.SELF_SERVICE],
        organization: { ...noneVisible, selfServiceCanSeeBookings: true },
      })
    ).toEqual({ canSeeAllBookings: true, canSeeAllCustody: false });
  });

  it("defaults an empty role list to the most restrictive (BASE) treatment", () => {
    expect(
      resolveCalendarVisibility({ roles: [], organization: noneVisible })
    ).toEqual({ canSeeAllBookings: false, canSeeAllCustody: false });
  });
});

describe("calendar feed tokens", () => {
  it("returns the existing token when one is already set", async () => {
    vi.mocked(db.userOrganization.findUnique).mockResolvedValue({
      calendarTokenId: "existing-token",
    } as never);

    const token = await getOrCreateCalendarToken({
      userId: USER_ID,
      organizationId: ORG_ID,
    });

    expect(token).toBe("existing-token");
    expect(db.userOrganization.update).not.toHaveBeenCalled();
  });

  it("generates and persists a token on first use", async () => {
    // why: a membership that exists with no token yet — the state a first use
    // starts from.
    vi.mocked(db.userOrganization.findUnique).mockResolvedValue({
      calendarTokenId: null,
    } as never);
    // why: count 1 = this caller's conditional write landed, so the token it
    // generated is the one the row now holds.
    vi.mocked(db.userOrganization.updateMany).mockResolvedValue({
      count: 1,
    } as never);

    const token = await getOrCreateCalendarToken({
      userId: USER_ID,
      organizationId: ORG_ID,
    });

    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(20); // unguessable, not a short id
    // The predicate is the guard: writing only while the token is null is what
    // makes two simultaneous first uses resolve to one token.
    expect(db.userOrganization.updateMany).toHaveBeenCalledWith({
      where: { ...WHERE_FLAT, calendarTokenId: null },
      data: { calendarTokenId: token },
    });
  });

  it("returns the token that persisted when a concurrent caller set one first", async () => {
    // Two callers reach the first-use path together — a double-click, two tabs,
    // a retried request. Only one write can land, and the other must report the
    // token the row actually holds rather than the one it generated, which
    // would hand the subscriber a URL that resolves to nothing.
    // why: two reads with different answers is the race itself — null first,
    // then another caller's token — which only a queued mock can express.
    vi.mocked(db.userOrganization.findUnique)
      .mockResolvedValueOnce({ calendarTokenId: null } as never)
      .mockResolvedValueOnce({ calendarTokenId: "winner-token" } as never);
    // why: count 0 = the row was no longer null when the write ran, which is
    // how this caller learns it lost.
    vi.mocked(db.userOrganization.updateMany).mockResolvedValue({
      count: 0,
    } as never);

    const token = await getOrCreateCalendarToken({
      userId: USER_ID,
      organizationId: ORG_ID,
    });

    expect(token).toBe("winner-token");
  });

  it("throws when the user is not a member of the workspace", async () => {
    vi.mocked(db.userOrganization.findUnique).mockResolvedValue(null);

    await expect(
      getOrCreateCalendarToken({ userId: USER_ID, organizationId: ORG_ID })
    ).rejects.toThrow();
  });

  it("rotates to a fresh token on each call", async () => {
    vi.mocked(db.userOrganization.update).mockResolvedValue({} as never);

    const a = await rotateCalendarToken({
      userId: USER_ID,
      organizationId: ORG_ID,
    });
    const b = await rotateCalendarToken({
      userId: USER_ID,
      organizationId: ORG_ID,
    });

    expect(a).not.toBe(b);
  });

  it("revokes by nulling the token", async () => {
    vi.mocked(db.userOrganization.update).mockResolvedValue({} as never);

    await revokeCalendarToken({ userId: USER_ID, organizationId: ORG_ID });

    expect(db.userOrganization.update).toHaveBeenCalledWith({
      where: WHERE,
      data: { calendarTokenId: null },
    });
  });

  it("resolves an unknown/revoked token to null", async () => {
    vi.mocked(db.userOrganization.findUnique).mockResolvedValue(null);
    expect(await getCalendarFeedContext("nope")).toBeNull();
  });

  it("resolves to null when the workspace is no longer entitled to bookings", async () => {
    vi.mocked(db.userOrganization.findUnique).mockResolvedValue({
      userId: USER_ID,
      organizationId: ORG_ID,
      roles: [OrganizationRoles.OWNER],
      organization: { name: "W", type: "PERSONAL" },
    } as never);
    // Security property: a token minted while entitled must stop working once
    // the workspace loses Bookings access (the public feed is cookie-bypassed).
    vi.mocked(canUseBookings).mockReturnValue(false);

    expect(await getCalendarFeedContext("valid-token")).toBeNull();
  });

  it("returns the member context when the workspace can use bookings", async () => {
    const membership = {
      userId: USER_ID,
      organizationId: ORG_ID,
      roles: [OrganizationRoles.OWNER],
      organization: { name: "W", type: "TEAM" },
    };
    vi.mocked(db.userOrganization.findUnique).mockResolvedValue(
      membership as never
    );
    vi.mocked(canUseBookings).mockReturnValue(true);

    expect(await getCalendarFeedContext("valid-token")).toEqual(membership);
  });
});

describe("calendar feed URL helpers", () => {
  it("buildCalendarFeedUrl points at the public feed route for the token", () => {
    expect(buildCalendarFeedUrl("abc-123")).toContain(
      "/api/calendar/feed/abc-123.ics"
    );
  });

  it("getMemberCalendarFeedUrl returns null when the member has no token", async () => {
    vi.mocked(db.userOrganization.findUnique).mockResolvedValue({
      calendarTokenId: null,
    } as never);

    expect(
      await getMemberCalendarFeedUrl({
        userId: USER_ID,
        organizationId: ORG_ID,
      })
    ).toBeNull();
  });

  it("getMemberCalendarFeedUrl returns the feed URL when a token exists", async () => {
    vi.mocked(db.userOrganization.findUnique).mockResolvedValue({
      calendarTokenId: "tok-xyz",
    } as never);

    expect(
      await getMemberCalendarFeedUrl({
        userId: USER_ID,
        organizationId: ORG_ID,
      })
    ).toContain("/api/calendar/feed/tok-xyz.ics");
  });
});

describe("assertMemberCanManageCalendar", () => {
  it("throws 403 when the user is not a member of the target workspace", async () => {
    vi.mocked(db.userOrganization.findUnique).mockResolvedValue(null);
    await expect(
      assertMemberCanManageCalendar({ userId: USER_ID, organizationId: ORG_ID })
    ).rejects.toThrow();
    expect(vi.mocked(assertCanUseBookings)).not.toHaveBeenCalled();
  });

  it("delegates to assertCanUseBookings for an entitled member", async () => {
    vi.mocked(db.userOrganization.findUnique).mockResolvedValue({
      organization: { type: "TEAM" },
    } as never);
    await assertMemberCanManageCalendar({
      userId: USER_ID,
      organizationId: ORG_ID,
    });
    expect(vi.mocked(assertCanUseBookings)).toHaveBeenCalledWith({
      type: "TEAM",
    });
  });
});

describe("getMemberCalendarFeeds", () => {
  it("lists eligible workspaces alphabetically and maps token -> feed URL / null", async () => {
    vi.mocked(canUseBookings).mockImplementation(
      (o: { type: string }) => o.type === "TEAM"
    );
    // Input is intentionally NOT alphabetical (Rentals before Acme) to prove the
    // result is sorted by name — the underlying order follows updatedAt.
    vi.mocked(db.user.findUnique).mockResolvedValue({
      sso: true,
      userOrganizations: [
        {
          roles: ["SELF_SERVICE"],
          calendarTokenId: null,
          organization: { id: "o2", name: "Rentals", type: "TEAM" },
        },
        {
          roles: ["OWNER"],
          calendarTokenId: "tok-a",
          organization: { id: "o1", name: "Acme", type: "TEAM" },
        },
        {
          roles: ["OWNER"],
          calendarTokenId: "tok-p",
          organization: { id: "o3", name: "Personal", type: "PERSONAL" },
        }, // SSO -> dropped
      ],
    } as never);

    const feeds = await getMemberCalendarFeeds({ userId: USER_ID });

    // Sorted alphabetically: Acme before Rentals (Personal excluded).
    expect(feeds).toEqual([
      {
        organizationId: "o1",
        name: "Acme",
        role: "OWNER",
        feedUrl: expect.stringContaining("/api/calendar/feed/tok-a.ics"),
      },
      {
        organizationId: "o2",
        name: "Rentals",
        role: "SELF_SERVICE",
        feedUrl: null,
      },
    ]);
  });
});
