import { loader } from "~/routes/api+/mobile+/bookings";
import { createLoaderArgs } from "@mocks/remix";

// @vitest-environment node

/**
 * Who a mobile bookings list is allowed to show.
 *
 * The rule belongs to the shared helpers web already uses, so these tests
 * assert that the route delegates to them with the right arguments rather than
 * restating the rule. Getting this wrong is quiet in both directions: too wide
 * leaks a colleague's bookings, too narrow hides a user's own.
 */

const createDataMock = vi.hoisted(
  () => () =>
    vi.fn(
      (body: unknown, init?: ResponseInit) =>
        new Response(JSON.stringify(body), {
          status: init?.status ?? 200,
          headers: { "Content-Type": "application/json" },
        })
    )
);

vi.mock("react-router", async () => ({
  ...(await vi.importActual("react-router")),
  data: createDataMock(),
}));

vi.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
  requireOrganizationAccess: vi.fn().mockResolvedValue("org-1"),
  getMobileUserContext: vi.fn().mockResolvedValue({ role: "ADMIN" }),
}));

vi.mock("~/modules/booking/service.server", () => ({
  bookingDraftVisibilityClause: vi.fn(() => ({ __draftClause: true })),
  // Sentinels, not reimplementations - see the calendar route's tests.
  resolveCustodianScope: vi.fn(async () => ({
    userId: "user-1",
    teamMemberIds: ["tm-1", "tm-2"],
  })),
  custodianScopeClause: vi.fn(() => ({ __custodianClause: true })),
}));

vi.mock("~/database/db.server", () => ({
  db: {
    booking: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
  },
}));

vi.mock("~/utils/error", () => ({
  makeShelfError: vi.fn((cause: any) => ({
    message: cause?.message ?? "error",
    status: cause?.status ?? 500,
  })),
}));

import { db } from "~/database/db.server";
import { getMobileUserContext } from "~/modules/api/mobile-auth.server";
import {
  custodianScopeClause,
  resolveCustodianScope,
} from "~/modules/booking/service.server";

const request = () =>
  new Request("http://localhost/api/mobile/bookings?orgId=org-1");

/** The `where` the list query actually ran with. */
function lastWhere(): any {
  return (db.booking.findMany as any).mock.calls.at(-1)?.[0]?.where;
}

describe("GET /api/mobile/bookings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (db.booking.findMany as any).mockResolvedValue([]);
    (db.booking.count as any).mockResolvedValue(0);
    (getMobileUserContext as any).mockResolvedValue({ role: "ADMIN" });
    (resolveCustodianScope as any).mockResolvedValue({
      userId: "user-1",
      teamMemberIds: ["tm-1", "tm-2"],
    });
    (custodianScopeClause as any).mockReturnValue({ __custodianClause: true });
  });

  it("scopes a SELF_SERVICE user through the shared custodian clause", async () => {
    (getMobileUserContext as any).mockResolvedValue({ role: "SELF_SERVICE" });

    await loader(createLoaderArgs({ request: request() }));

    expect(resolveCustodianScope).toHaveBeenCalledWith({
      userId: "user-1",
      organizationId: "org-1",
    });
    // The resolved scope carries the user's team-member links, and those are
    // what build the clause. Matching only `custodianUserId` hid a user's own
    // bookings whenever their custody came from a team member rather than a
    // user - visible on the website, missing on the phone.
    expect(custodianScopeClause).toHaveBeenCalledWith({
      userId: "user-1",
      teamMemberIds: ["tm-1", "tm-2"],
    });
    expect(lastWhere().AND).toContainEqual({ __custodianClause: true });
  });

  it("scopes a BASE user the same way", async () => {
    (getMobileUserContext as any).mockResolvedValue({ role: "BASE" });

    await loader(createLoaderArgs({ request: request() }));

    expect(custodianScopeClause).toHaveBeenCalled();
    expect(lastWhere().AND).toContainEqual({ __custodianClause: true });
  });

  it("does not narrow an ADMIN to their own bookings", async () => {
    await loader(createLoaderArgs({ request: request() }));

    expect(resolveCustodianScope).not.toHaveBeenCalled();
    expect(lastWhere().AND).not.toContainEqual({ __custodianClause: true });
  });

  it("always applies draft privacy, whatever the role", async () => {
    for (const role of ["ADMIN", "SELF_SERVICE", "BASE"]) {
      vi.clearAllMocks();
      (db.booking.findMany as any).mockResolvedValue([]);
      (db.booking.count as any).mockResolvedValue(0);
      (getMobileUserContext as any).mockResolvedValue({ role });

      await loader(createLoaderArgs({ request: request() }));

      expect(lastWhere().AND).toContainEqual({ __draftClause: true });
    }
  });
});
