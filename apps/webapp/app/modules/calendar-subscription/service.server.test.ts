// @vitest-environment node
import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "~/database/db.server";
import { canUseBookings } from "~/utils/subscription.server";
import {
  buildCalendarFeedUrl,
  getCalendarFeedContext,
  getMemberCalendarFeedUrl,
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
    },
  },
}));

// why: drive the workspace-entitlement gate deterministically, independent of
// env-derived premium flags (premiumIsEnabled). Defaults to entitled; tests
// that assert the gate override the return value explicitly.
vi.mock("~/utils/subscription.server", () => ({
  canUseBookings: vi.fn(() => true),
}));

const USER_ID = "user-1";
const ORG_ID = "org-1";
const WHERE = {
  userId_organizationId: { userId: USER_ID, organizationId: ORG_ID },
};

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
    vi.mocked(db.userOrganization.findUnique).mockResolvedValue({
      calendarTokenId: null,
    } as never);
    vi.mocked(db.userOrganization.update).mockResolvedValue({} as never);

    const token = await getOrCreateCalendarToken({
      userId: USER_ID,
      organizationId: ORG_ID,
    });

    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(20); // unguessable, not a short id
    expect(db.userOrganization.update).toHaveBeenCalledWith({
      where: WHERE,
      data: { calendarTokenId: token },
    });
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
