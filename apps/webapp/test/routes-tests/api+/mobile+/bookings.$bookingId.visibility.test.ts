/**
 * Who may OPEN a booking on the phone.
 *
 * The endpoint reads the booking org-scoped, then judges it with the shared
 * `canSeeBooking` — the same helper and the same 403 the web overview route
 * uses. Two properties follow, and both are asserted here: a refusal reads as
 * 403 rather than as a missing row, and the answer can account for the
 * workspace override because the row is already in hand when it is made.
 *
 * @see {@link file://./../../../../app/routes/api+/mobile+/bookings.$bookingId.ts} loader under test
 * @see {@link file://./../../../../app/utils/booking-authorization.server.ts} `canSeeBooking`
 */

import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLoaderArgs } from "@mocks/remix";

import { db } from "~/database/db.server";
import type * as MobileAuthServer from "~/modules/api/mobile-auth.server";
import {
  requireMobileAuth,
  requireOrganizationAccess,
  getMobileUserContext,
} from "~/modules/api/mobile-auth.server";

import { loader } from "~/routes/api+/mobile+/bookings.$bookingId";

import { assertIsDataWithResponseInit } from "@helpers/assertions";
import { mobileUserContext } from "@helpers/mobile-user-context";

// @vitest-environment node

vi.mock("~/database/db.server", () => ({
  db: {
    booking: { findFirst: vi.fn() },
    bookingAsset: { findMany: vi.fn().mockResolvedValue([]) },
    partialBookingCheckout: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock("~/modules/api/mobile-auth.server", async () => {
  const actual = await vi.importActual<typeof MobileAuthServer>(
    "~/modules/api/mobile-auth.server"
  );
  return {
    ...actual,
    requireMobileAuth: vi.fn(),
    requireOrganizationAccess: vi.fn(),
    assertMobileCanUseBookings: vi.fn(),
    getMobileUserContext: vi.fn(),
  };
});

// why: booking settings and the action-permission lookup are unrelated to the
// visibility question under test — stub them to fixed values.
vi.mock("~/modules/booking-settings/service.server", () => ({
  getBookingSettingsForOrganization: vi.fn().mockResolvedValue({
    requireExplicitCheckinForAdmin: false,
    requireExplicitCheckinForSelfService: false,
  }),
}));
vi.mock("~/utils/permissions/permission.validator.server", () => ({
  hasPermission: vi.fn().mockResolvedValue(false),
}));

const CALLER = "user-1";
const SOMEONE_ELSE = "user-2";

const findFirstMock = vi.mocked(db.booking.findFirst);
const getMobileUserContextMock = vi.mocked(getMobileUserContext);

/**
 * A minimal DRAFT-free booking row. DRAFT is avoided so the loader skips the
 * partial-check-in lookup; custody is the only variable that matters here.
 */
function bookingRow(
  custody: {
    custodianUserId?: string | null;
    custodianTeamMember?: {
      id: string;
      name: string;
      userId: string | null;
    } | null;
  } = {}
) {
  return {
    id: "booking-1",
    name: "Traslado",
    description: null,
    status: "RESERVED",
    from: new Date("2026-01-01T00:00:00.000Z"),
    to: new Date("2026-01-02T00:00:00.000Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    creator: null,
    custodianUserId: custody.custodianUserId ?? null,
    custodianUser: null,
    custodianTeamMember: custody.custodianTeamMember ?? null,
    tags: [],
    bookingAssets: [],
    modelRequests: [],
    _count: { bookingAssets: 0 },
  } as never;
}

async function get() {
  return loader(
    createLoaderArgs({
      request: new Request(
        "http://localhost:3000/api/mobile/bookings/booking-1"
      ),
      params: { bookingId: "booking-1" },
    })
  );
}

/** The `where` the detail query actually ran with. */
function lastWhere(): any {
  return findFirstMock.mock.calls.at(-1)?.[0]?.where;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireMobileAuth).mockResolvedValue({
    user: { id: CALLER },
  } as Awaited<ReturnType<typeof requireMobileAuth>>);
  vi.mocked(requireOrganizationAccess).mockResolvedValue("org-1");
});

describe("GET /api/mobile/bookings/:bookingId — who may open it", () => {
  it("never puts custody in the query, so the row is read before it is judged", async () => {
    getMobileUserContextMock.mockResolvedValue(
      mobileUserContext({ roles: [OrganizationRoles.BASE] })
    );
    findFirstMock.mockResolvedValue(bookingRow({ custodianUserId: CALLER }));

    await get();

    // A custodian clause here would decide visibility before the row is read,
    // which both loses the workspace override and turns a refusal into a 404.
    expect(JSON.stringify(lastWhere())).not.toContain("custodian");
  });

  it("refuses someone else's booking with 403, not 404, when the override is off", async () => {
    getMobileUserContextMock.mockResolvedValue(
      mobileUserContext({ roles: [OrganizationRoles.BASE] })
    );
    findFirstMock.mockResolvedValue(
      bookingRow({ custodianUserId: SOMEONE_ELSE })
    );

    const response = await get();

    assertIsDataWithResponseInit(response);
    expect(response.init?.status).toBe(403);
  });

  it.each([OrganizationRoles.BASE, OrganizationRoles.SELF_SERVICE])(
    "opens someone else's booking for %s once the workspace override is on",
    async (role) => {
      getMobileUserContextMock.mockResolvedValue(
        mobileUserContext({ roles: [role], canSeeAllBookings: true })
      );
      findFirstMock.mockResolvedValue(
        bookingRow({ custodianUserId: SOMEONE_ELSE })
      );

      const response = await get();

      assertIsDataWithResponseInit(response);
      expect(response.init?.status ?? 200).toBe(200);
    }
  );

  it("opens the caller's OWN booking through the user link", async () => {
    // Guards the `custodianUserId` scalar in the select. `canSeeBooking` reads
    // it, while the endpoint selects the custodianUser RELATION for display —
    // drop the scalar and every restricted user 403s on their own booking.
    getMobileUserContextMock.mockResolvedValue(
      mobileUserContext({ roles: [OrganizationRoles.BASE] })
    );
    findFirstMock.mockResolvedValue(bookingRow({ custodianUserId: CALLER }));

    const response = await get();

    assertIsDataWithResponseInit(response);
    expect(response.init?.status ?? 200).toBe(200);
  });

  it("opens the caller's OWN booking through the team-member link", async () => {
    // Custody assigned by picking a team member leaves `custodianUserId` NULL.
    // Matching the user link alone refuses the very user it belongs to.
    getMobileUserContextMock.mockResolvedValue(
      mobileUserContext({ roles: [OrganizationRoles.BASE] })
    );
    findFirstMock.mockResolvedValue(
      bookingRow({
        custodianUserId: null,
        custodianTeamMember: { id: "tm-1", name: "Caller", userId: CALLER },
      })
    );

    const response = await get();

    assertIsDataWithResponseInit(response);
    expect(response.init?.status ?? 200).toBe(200);
  });

  it("still 404s a booking that genuinely is not there", async () => {
    getMobileUserContextMock.mockResolvedValue(
      mobileUserContext({ roles: [OrganizationRoles.ADMIN] })
    );
    findFirstMock.mockResolvedValue(null);

    const response = await get();

    assertIsDataWithResponseInit(response);
    expect(response.init?.status).toBe(404);
  });
});
