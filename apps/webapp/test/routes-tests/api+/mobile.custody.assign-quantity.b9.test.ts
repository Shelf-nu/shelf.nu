/**
 * Mixed-role memberships on the mobile quantity custody assignment route.
 *
 * The route decides "may only assign to yourself" from the membership's
 * custody scope (`access.custody.assign`), which follows the effective
 * (highest) role, like the web. The order the roles are stored in does not
 * matter: a membership whose FIRST role is SELF_SERVICE but which also holds
 * ADMIN is an admin, and one whose first role is BASE but which also holds
 * SELF_SERVICE is self-only.
 *
 * @see {@link file://../../../app/routes/api+/mobile+/custody.assign-quantity.ts}
 */
import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mobileUserContext } from "@helpers/mobile-user-context";
import { createActionArgs } from "@mocks/remix";

// @vitest-environment node

// why: the route returns `data()`; turning it into a real Response lets the
// test read the status the client would see
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    data: vi.fn(
      (body: unknown, init?: ResponseInit) =>
        new Response(JSON.stringify(body), {
          status: init?.status ?? 200,
          headers: { "Content-Type": "application/json" },
        })
    ),
  };
});

// why: bearer-token auth needs Supabase; the guard under test runs after it
vi.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vi.fn(async () => ({ user: { id: "caller" } })),
  requireOrganizationAccess: vi.fn(async () => "org-1"),
  requireMobilePermission: vi.fn(async () => undefined),
  getMobileUserContext: vi.fn(),
  getMobileAssetForViewer: vi.fn(async () => ({ id: "asset-1" })),
}));

// why: the rate limiter keeps per-user counters; this test is about authorization
vi.mock("~/utils/rate-limit.server", () => ({
  enforceUserRateLimit: vi.fn(async () => undefined),
}));

// why: the quantity service writes custody rows; the test only needs to know
// whether the route let the request reach it
vi.mock("~/modules/asset/service.server", () => ({
  // The service returns the checked-out asset and where its units came from;
  // a pool at one location reports no explicit source.
  checkOutQuantity: vi.fn(async () => ({
    asset: { id: "asset-1" },
    source: {
      locationId: null,
      locationName: null,
      explicit: false,
      multiSource: false,
    },
  })),
}));

// why: the team member lookup is a database read; its result (a colleague) is the input
vi.mock("~/modules/team-member/service.server", () => ({
  getTeamMember: vi.fn(async () => ({
    id: "tm-colleague",
    name: "Colleague",
    userId: "colleague",
    user: {
      id: "colleague",
      firstName: "C",
      lastName: "L",
      displayName: null,
    },
  })),
}));

// why: the actor lookup for the audit note is a database read, written after the guard
vi.mock("~/modules/user/service.server", () => ({
  getUserByID: vi.fn(async () => ({
    id: "caller",
    firstName: "A",
    lastName: "B",
    displayName: null,
  })),
}));

// why: notes are written after the guard and are not under test
vi.mock("~/modules/note/service.server", () => ({ createNote: vi.fn() }));

// why: the low-stock check sends notifications after the guard; not under test
vi.mock("~/modules/consumption-log/low-stock.server", () => ({
  checkAndNotifyLowStock: vi.fn(async () => undefined),
}));

import { getMobileUserContext } from "~/modules/api/mobile-auth.server";
import { checkOutQuantity } from "~/modules/asset/service.server";
import { action } from "~/routes/api+/mobile+/custody.assign-quantity";

/** POSTs an assignment of one unit to a colleague (not the caller). */
function post() {
  const request = new Request(
    "http://localhost/api/mobile/custody/assign-quantity?orgId=org-1",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer t",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        assetId: "asset-1",
        teamMemberId: "tm-colleague",
        quantity: 1,
      }),
    }
  );
  return action(createActionArgs({ request })) as unknown as Promise<Response>;
}

describe("POST /api/mobile/custody/assign-quantity: mixed roles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lets a [SELF_SERVICE, ADMIN] membership assign to a colleague", async () => {
    vi.mocked(getMobileUserContext).mockResolvedValue(
      mobileUserContext({
        roles: [OrganizationRoles.SELF_SERVICE, OrganizationRoles.ADMIN],
      }) as never
    );

    const res = await post();

    expect(res.status).toBe(200);
    expect(checkOutQuantity).toHaveBeenCalled();
  });

  it("refuses a [BASE, SELF_SERVICE] membership assigning to a colleague", async () => {
    vi.mocked(getMobileUserContext).mockResolvedValue(
      mobileUserContext({
        roles: [OrganizationRoles.BASE, OrganizationRoles.SELF_SERVICE],
      }) as never
    );

    const res = await post();

    expect(res.status).toBe(403);
    expect(checkOutQuantity).not.toHaveBeenCalled();
  });

  it("still refuses a SELF_SERVICE-only membership", async () => {
    vi.mocked(getMobileUserContext).mockResolvedValue(
      mobileUserContext({ roles: [OrganizationRoles.SELF_SERVICE] }) as never
    );

    const res = await post();

    expect(res.status).toBe(403);
    expect(checkOutQuantity).not.toHaveBeenCalled();
  });
});
