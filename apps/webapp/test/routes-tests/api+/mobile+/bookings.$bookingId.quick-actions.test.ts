/**
 * Response-contract test for the quick-action flags the mobile booking detail
 * endpoint sends. The companion shows "Check Out All Assets" only when
 * `canQuickCheckout` is true and "Check In All" only when `canQuickCheckin` is,
 * and the matching action endpoints refuse the one-tap path otherwise. So the
 * flags must agree with those endpoints:
 *
 * 1. A workspace switch requires the explicit flow for ADMIN or SELF_SERVICE
 *    only: OWNER is exempt and BASE is not covered.
 * 2. The role is the membership's most privileged one, never `roles[0]`.
 * 3. The check-in and check-out switches are independent.
 *
 * @see {@link file://./../../../../app/routes/api+/mobile+/bookings.$bookingId.ts} loader under test
 */

import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBookingSettings } from "@factories";
import { createLoaderArgs } from "@mocks/remix";

import type * as MobileAuthServer from "~/modules/api/mobile-auth.server";
import {
  requireMobileAuth,
  requireOrganizationAccess,
  getMobileUserContext,
} from "~/modules/api/mobile-auth.server";
import { getBookingSettingsForOrganization } from "~/modules/booking-settings/service.server";

import { loader } from "~/routes/api+/mobile+/bookings.$bookingId";

import { assertIsDataWithResponseInit } from "@helpers/assertions";
import { mobileUserContext } from "@helpers/mobile-user-context";

// @vitest-environment node

// why: the module instantiates a real Prisma client at load and would try to
// connect; the suite runs with no database. The booking read returns a fixed
// row, and the lifecycle roll-up's reads return nothing.
vi.mock("~/database/db.server", () => ({
  db: {
    booking: { findFirst: vi.fn() },
    bookingAsset: { findMany: vi.fn().mockResolvedValue([]) },
    partialBookingCheckout: { findMany: vi.fn().mockResolvedValue([]) },
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

// why: the workspace switches are the other variable under test; each case
// sets them, and reading them for real would need the database.
vi.mock("~/modules/booking-settings/service.server", () => ({
  getBookingSettingsForOrganization: vi.fn(),
}));

// why: a DRAFT asks the overlapping-booking query for its Reserve flag; that
// query reads the database and does not decide the approval flags under test.
vi.mock("~/modules/booking/service.server", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getBookingFlags: vi.fn().mockResolvedValue({ hasAlreadyBookedAssets: false }),
}));

// why: the per-booking action availability is a separate contract from the
// quick-action flags; a fixed `false` keeps it off the permission tables.
vi.mock("~/utils/permissions/permission.validator.server", () => ({
  hasPermission: vi.fn().mockResolvedValue(false),
}));

const CALLER = "user-1";

/** A reserved booking the caller holds, so every role may read it. */
const BOOKING_ROW = {
  id: "booking-1",
  name: "Volunteer kit pick-up",
  description: null,
  status: "RESERVED",
  from: new Date("2026-01-01T00:00:00.000Z"),
  to: new Date("2026-01-02T00:00:00.000Z"),
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  creator: null,
  custodianUserId: CALLER,
  custodianUser: null,
  custodianTeamMember: null,
  tags: [],
  bookingAssets: [],
  modelRequests: [],
  _count: { bookingAssets: 0 },
} as never;

/** The four explicit-flow switches, all off unless a case turns one on. */
function switches(
  on: {
    checkinAdmin?: boolean;
    checkinSelfService?: boolean;
    checkoutAdmin?: boolean;
    checkoutSelfService?: boolean;
  } = {}
) {
  return createBookingSettings({
    requireExplicitCheckinForAdmin: on.checkinAdmin ?? false,
    requireExplicitCheckinForSelfService: on.checkinSelfService ?? false,
    requireExplicitCheckoutForAdmin: on.checkoutAdmin ?? false,
    requireExplicitCheckoutForSelfService: on.checkoutSelfService ?? false,
  });
}

/** Runs the loader as a caller with `roles` and returns the two flags. */
async function quickFlagsFor(
  roles: OrganizationRoles[],
  settings: ReturnType<typeof switches>
) {
  vi.mocked(getMobileUserContext).mockResolvedValue(
    mobileUserContext({ roles })
  );
  vi.mocked(getBookingSettingsForOrganization).mockResolvedValue(settings);

  const response = await loader(
    createLoaderArgs({
      request: new Request(
        "http://localhost:3000/api/mobile/bookings/booking-1"
      ),
      params: { bookingId: "booking-1" },
    })
  );
  assertIsDataWithResponseInit(response);
  const body = response.data as {
    canQuickCheckin: boolean;
    canQuickCheckout: boolean;
  };
  return {
    canQuickCheckin: body.canQuickCheckin,
    canQuickCheckout: body.canQuickCheckout,
  };
}

/**
 * The approval flags of the detail payload for `roles` viewing `row` under
 * `settings`. `approver` makes `hasPermission` answer true for booking:approve,
 * standing in for a role whose matrix row (or short-circuit) holds it.
 */
async function approvalFlagsFor({
  roles,
  settings,
  row,
  approver = false,
}: {
  roles: OrganizationRoles[];
  settings: ReturnType<typeof switches>;
  row: typeof BOOKING_ROW;
  approver?: boolean;
}) {
  const { db } = await import("~/database/db.server");
  vi.mocked(db.booking.findFirst).mockResolvedValue(row);
  const { hasPermission } = await import(
    "~/utils/permissions/permission.validator.server"
  );
  vi.mocked(hasPermission).mockImplementation(
    async ({ action }: { action: string }) => approver && action === "approve"
  );
  vi.mocked(getMobileUserContext).mockResolvedValue(
    mobileUserContext({ roles })
  );
  vi.mocked(getBookingSettingsForOrganization).mockResolvedValue(settings);
  const response = await loader(
    createLoaderArgs({
      request: new Request(
        "http://localhost:3000/api/mobile/bookings/booking-1"
      ),
      params: { bookingId: "booking-1" },
    })
  );
  assertIsDataWithResponseInit(response);
  if (!(response.data as { booking?: unknown }).booking) {
    throw new Error(
      `loader answered without a booking: ${JSON.stringify(response.data).slice(
        0,
        300
      )}`
    );
  }
  const body = response.data as {
    canCheckout: boolean;
    booking: {
      isPendingApproval: boolean;
      canApprove: boolean;
      reservationNeedsApproval: boolean;
    };
  };
  return {
    canCheckout: body.canCheckout,
    isPendingApproval: body.booking.isPendingApproval,
    canApprove: body.booking.canApprove,
    reservationNeedsApproval: body.booking.reservationNeedsApproval,
  };
}

describe("GET /api/mobile/bookings/:bookingId: approval flags", () => {
  const requiresApproval = createBookingSettings({
    requireBookingApproval: true,
  });
  const pendingRow = {
    ...(BOOKING_ROW as Record<string, unknown>),
    approvedAt: null,
  } as never;
  const draftRow = {
    ...(BOOKING_ROW as Record<string, unknown>),
    status: "DRAFT",
    approvedAt: null,
  } as never;

  it("marks a never-approved reservation pending and withholds check-out", async () => {
    const flags = await approvalFlagsFor({
      roles: [OrganizationRoles.MANAGER],
      settings: requiresApproval,
      row: pendingRow,
      approver: true,
    });
    expect(flags.isPendingApproval).toBe(true);
    expect(flags.canCheckout).toBe(false);
    expect(flags.canApprove).toBe(true);
  });

  it("offers no approve action to a caller without booking:approve", async () => {
    const flags = await approvalFlagsFor({
      roles: [OrganizationRoles.BASE],
      settings: requiresApproval,
      row: pendingRow,
    });
    expect(flags.isPendingApproval).toBe(true);
    expect(flags.canApprove).toBe(false);
  });

  it("reads nothing as pending while the workspace does not require approval", async () => {
    const flags = await approvalFlagsFor({
      roles: [OrganizationRoles.MANAGER],
      settings: switches(),
      row: pendingRow,
      approver: true,
    });
    expect(flags.isPendingApproval).toBe(false);
    expect(flags.canApprove).toBe(false);
  });

  it("tells a Base caller their draft will reserve as a request, and an admin that theirs will not", async () => {
    const base = await approvalFlagsFor({
      roles: [OrganizationRoles.BASE],
      settings: requiresApproval,
      row: draftRow,
    });
    const admin = await approvalFlagsFor({
      roles: [OrganizationRoles.ADMIN],
      settings: requiresApproval,
      row: draftRow,
      approver: true,
    });
    expect(base.reservationNeedsApproval).toBe(true);
    expect(admin.reservationNeedsApproval).toBe(false);
  });
});

beforeEach(async () => {
  vi.clearAllMocks();
  const { db } = await import("~/database/db.server");
  vi.mocked(db.booking.findFirst).mockResolvedValue(BOOKING_ROW);
  vi.mocked(requireMobileAuth).mockResolvedValue({
    user: { id: CALLER },
  } as Awaited<ReturnType<typeof requireMobileAuth>>);
  vi.mocked(requireOrganizationAccess).mockResolvedValue("org-1");
});

describe("GET /api/mobile/bookings/:bookingId — canQuickCheckout", () => {
  it("is false for a SELF_SERVICE caller when Self Service must check out explicitly", async () => {
    const flags = await quickFlagsFor(
      [OrganizationRoles.SELF_SERVICE],
      switches({ checkoutSelfService: true })
    );

    expect(flags.canQuickCheckout).toBe(false);
  });

  it("is false for an ADMIN caller when admins must check out explicitly", async () => {
    const flags = await quickFlagsFor(
      [OrganizationRoles.ADMIN],
      switches({ checkoutAdmin: true })
    );

    expect(flags.canQuickCheckout).toBe(false);
  });

  it("stays true for the OWNER whatever the switches say", async () => {
    const flags = await quickFlagsFor(
      [OrganizationRoles.OWNER],
      switches({ checkoutAdmin: true, checkoutSelfService: true })
    );

    expect(flags.canQuickCheckout).toBe(true);
  });

  it("stays true for a BASE caller, whom the switches do not cover", async () => {
    const flags = await quickFlagsFor(
      [OrganizationRoles.BASE],
      switches({ checkoutAdmin: true, checkoutSelfService: true })
    );

    expect(flags.canQuickCheckout).toBe(true);
  });

  it("judges a multi-role membership by its most privileged role", async () => {
    // [SELF_SERVICE, ADMIN] is an admin, so the Self Service switch does not
    // apply, even though SELF_SERVICE comes first in the array.
    const flags = await quickFlagsFor(
      [OrganizationRoles.SELF_SERVICE, OrganizationRoles.ADMIN],
      switches({ checkoutSelfService: true })
    );

    expect(flags.canQuickCheckout).toBe(true);
  });

  it("is independent of the explicit check-in switches", async () => {
    const checkinOnly = await quickFlagsFor(
      [OrganizationRoles.SELF_SERVICE],
      switches({ checkinSelfService: true })
    );
    expect(checkinOnly).toEqual({
      canQuickCheckin: false,
      canQuickCheckout: true,
    });

    const checkoutOnly = await quickFlagsFor(
      [OrganizationRoles.SELF_SERVICE],
      switches({ checkoutSelfService: true })
    );
    expect(checkoutOnly).toEqual({
      canQuickCheckin: true,
      canQuickCheckout: false,
    });
  });
});
