/**
 * Response-contract test for `bookingActions.canExtend`, the flag the companion
 * reads to offer "Extend booking". It must agree with the gates the extend
 * endpoint makes: the booking is ONGOING or OVERDUE with something still out,
 * the caller holds `booking:extend` (BASE does not), and the caller writes this
 * booking (seeing it through a workspace toggle is not enough).
 *
 * The permission matrix is the real one: `hasPermission` with the
 * membership's roles is a pure lookup.
 *
 * @see {@link file://./../../../../app/routes/api+/mobile+/bookings.$bookingId.ts} loader under test
 * @see {@link file://./../../../../app/routes/api+/mobile+/bookings.extend.ts} the endpoint the flag mirrors
 */

import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLoaderArgs } from "@mocks/remix";

import type * as MobileAuthServer from "~/modules/api/mobile-auth.server";
import {
  requireMobileAuth,
  requireOrganizationAccess,
  getMobileUserContext,
} from "~/modules/api/mobile-auth.server";
import type * as BookingServiceServer from "~/modules/booking/service.server";
import type { WorkspaceAccessSettings } from "~/utils/permissions/role-access";

import { loader } from "~/routes/api+/mobile+/bookings.$bookingId";

import { assertIsDataWithResponseInit } from "@helpers/assertions";
import { mobileUserContext } from "@helpers/mobile-user-context";

// @vitest-environment node

// why: the module instantiates a real Prisma client at load and would try to
// connect; the suite runs with no database. The booking read returns a fixed
// row with one individual asset, so every other read returns nothing.
vi.mock("~/database/db.server", () => ({
  db: {
    booking: { findFirst: vi.fn() },
    bookingAsset: { findMany: vi.fn().mockResolvedValue([]) },
    asset: { findMany: vi.fn().mockResolvedValue([]) },
    assetLocation: { findMany: vi.fn().mockResolvedValue([]) },
    custody: { findMany: vi.fn().mockResolvedValue([]) },
    partialBookingCheckout: { findMany: vi.fn().mockResolvedValue([]) },
    consumptionLog: { findMany: vi.fn().mockResolvedValue([]) },
    kit: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

// why: JWT validation and org-membership resolution are out of scope, and the
// caller's roles are the variable under test. The remaining exports stay real.
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

// why: an active booking's partial check-ins are read through a client this
// suite has no database for; none exist here.
vi.mock("~/modules/booking/service.server", async () => {
  const actual = await vi.importActual<typeof BookingServiceServer>(
    "~/modules/booking/service.server"
  );
  return {
    ...actual,
    getDetailedPartialCheckinData: vi
      .fn()
      .mockResolvedValue({ checkedInAssetIds: [], partialCheckinDetails: {} }),
  };
});

// why: workspace check-in/out policy is unrelated to extending; fixed values
// keep the rest of the response deterministic.
vi.mock("~/modules/booking-settings/service.server", () => ({
  getBookingSettingsForOrganization: vi.fn().mockResolvedValue({
    requireExplicitCheckinForAdmin: false,
    requireExplicitCheckinForSelfService: false,
    requireExplicitCheckoutForAdmin: false,
    requireExplicitCheckoutForSelfService: false,
    countKitsAsSingleUnit: false,
  }),
}));

const CALLER = "user-1";
const SOMEONE_ELSE = "user-2";

/**
 * A booking in `status`, held by `custodianUserId`, holding one individual
 * asset in `assetStatus`.
 *
 * @param status - The booking status
 * @param custodianUserId - Who holds the booking through the user link
 * @param assetStatus - The asset's status; CHECKED_OUT keeps it out
 */
function bookingRow(
  status: string,
  custodianUserId: string,
  assetStatus = "CHECKED_OUT"
) {
  return {
    id: "booking-1",
    name: "Site survey",
    description: null,
    status,
    from: new Date("2026-01-01T00:00:00.000Z"),
    to: new Date("2026-01-02T00:00:00.000Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    creator: null,
    custodianUserId,
    custodianUser: null,
    custodianTeamMember: null,
    tags: [],
    bookingAssets: [
      {
        id: "ba-1",
        quantity: 1,
        assetKitId: null,
        sourceKitId: null,
        sourceLocationId: null,
        asset: {
          id: "asset-1",
          title: "Camera",
          status: assetStatus,
          availableToBook: true,
          archivedAt: null,
          type: "INDIVIDUAL",
          unitOfMeasure: null,
          consumptionType: null,
          mainImage: null,
          thumbnailImage: null,
          mainImageExpiration: null,
          assetModel: null,
          category: null,
          assetKits: [],
          assetLocations: [],
        },
      },
    ],
    modelRequests: [],
    _count: { bookingAssets: 1 },
  } as never;
}

/**
 * Runs the loader as a caller with `roles` against `row` and returns the flag.
 *
 * @param roles - Every role on the caller's membership
 * @param row - The booking row the org-scoped read returns
 * @param workspace - Visibility toggles to switch on
 */
async function canExtendFor(
  roles: OrganizationRoles[],
  row: ReturnType<typeof bookingRow>,
  workspace: Partial<WorkspaceAccessSettings> = {}
) {
  const { db } = await import("~/database/db.server");
  vi.mocked(db.booking.findFirst).mockResolvedValue(row);
  vi.mocked(getMobileUserContext).mockResolvedValue(
    mobileUserContext({ roles, workspace })
  );

  const response = await loader(
    createLoaderArgs({
      request: new Request(
        "http://localhost:3000/api/mobile/bookings/booking-1"
      ),
      params: { bookingId: "booking-1" },
    })
  );
  assertIsDataWithResponseInit(response);
  const body = response.data as { bookingActions: { canExtend: boolean } };
  return body.bookingActions.canExtend;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireMobileAuth).mockResolvedValue({
    user: { id: CALLER },
  } as Awaited<ReturnType<typeof requireMobileAuth>>);
  vi.mocked(requireOrganizationAccess).mockResolvedValue("org-1");
});

describe("GET /api/mobile/bookings/:bookingId: canExtend", () => {
  it("is true for the OWNER on an ONGOING booking", async () => {
    expect(
      await canExtendFor(
        [OrganizationRoles.OWNER],
        bookingRow("ONGOING", SOMEONE_ELSE)
      )
    ).toBe(true);
  });

  it("is true for the OWNER on an OVERDUE booking", async () => {
    expect(
      await canExtendFor(
        [OrganizationRoles.OWNER],
        bookingRow("OVERDUE", SOMEONE_ELSE)
      )
    ).toBe(true);
  });

  it("is false for the OWNER on an ONGOING booking with everything returned", async () => {
    // The service refuses this one: a booking with nothing out is completed,
    // not extended.
    expect(
      await canExtendFor(
        [OrganizationRoles.OWNER],
        bookingRow("ONGOING", SOMEONE_ELSE, "AVAILABLE")
      )
    ).toBe(false);
  });

  it("is false for the OWNER on a RESERVED booking", async () => {
    expect(
      await canExtendFor(
        [OrganizationRoles.OWNER],
        bookingRow("RESERVED", SOMEONE_ELSE)
      )
    ).toBe(false);
  });

  it("is false for BASE on its own ONGOING booking, and true for SELF_SERVICE on theirs", async () => {
    // Same relationship to the booking; only the booking:extend grant differs.
    expect(
      await canExtendFor(
        [OrganizationRoles.BASE],
        bookingRow("ONGOING", CALLER)
      )
    ).toBe(false);
    expect(
      await canExtendFor(
        [OrganizationRoles.SELF_SERVICE],
        bookingRow("ONGOING", CALLER)
      )
    ).toBe(true);
  });

  it("is false for SELF_SERVICE on someone else's ONGOING booking it can see", async () => {
    expect(
      await canExtendFor(
        [OrganizationRoles.SELF_SERVICE],
        bookingRow("ONGOING", SOMEONE_ELSE),
        { selfServiceCanSeeBookings: true }
      )
    ).toBe(false);
  });
});
