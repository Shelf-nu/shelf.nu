// @vitest-environment node
/**
 * Asset overview loader: the over-commitment notice and the booking it names.
 *
 * For a quantity-tracked pool the loader decides whether bookings ahead ask for
 * more units than the workspace owns, and names the biggest upcoming booking
 * when they do. The name costs a booking read, which only an over-committed
 * pool has a use for: a pool within its size shows no notice at all.
 *
 * The naming is gated by `canSeeBooking`, so a viewer limited to their own
 * bookings still reads the shortfall but not someone else's booking name.
 *
 * @see {@link file://./../../../app/routes/_layout+/assets.$assetId.overview.tsx}
 * @see {@link file://./../../../app/modules/asset/over-commitment.ts}
 */
import { OrganizationRoles } from "@prisma/client";
import { permissionContext } from "@helpers/role-access";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { db } = vi.hoisted(() => ({
  db: {
    booking: { findFirst: vi.fn() },
    bookingAsset: { groupBy: vi.fn() },
    location: { findMany: vi.fn() },
    kit: { findMany: vi.fn() },
  },
}));
// why: the loader's booking lookups and move-units destinations read through
// `db`; an in-memory stand-in lets the tests observe which reads run.
vi.mock("~/database/db.server", () => ({ db }));

const { mockRequirePermission } = vi.hoisted(() => ({
  mockRequirePermission: vi.fn(),
}));
// why: the RBAC gate is not under test; it hands back the viewer's access.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: mockRequirePermission,
}));

// why: the audits add-on rule also reads premium env flags; it is reduced to
// the workspace's own flag, which these tests keep off.
vi.mock("~/utils/subscription.server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  canUseAudits: (org: { auditsEnabled: boolean }) => org.auditsEnabled,
}));

const { mockGetAsset } = vi.hoisted(() => ({ mockGetAsset: vi.fn() }));
// why: the asset read and the editor's category and location pickers hit the
// database; the test supplies the asset row and empty pickers.
vi.mock("~/modules/asset/service.server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAsset: mockGetAsset,
  getCategoriesForCreateAndEdit: vi
    .fn()
    .mockResolvedValue({ categories: [], totalCategories: 0 }),
  getLocationsForCreateAndEdit: vi
    .fn()
    .mockResolvedValue({ locations: [], totalLocations: 0 }),
}));

const { mockGetAssetAvailability } = vi.hoisted(() => ({
  mockGetAssetAvailability: vi.fn(),
}));
// why: the availability primitive is pinned in its own tests; here it supplies
// the peak that decides whether the pool is over-committed.
vi.mock("~/modules/asset/availability.server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAssetAvailability: mockGetAssetAvailability,
}));

// why: the last scan read hits the database and is pinned in its own test.
vi.mock("~/modules/scan/service.server", () => ({
  getLastScanForViewer: vi.fn().mockResolvedValue(null),
}));

// why: QR generation reads and writes QR rows; unrelated to the notice.
vi.mock("~/modules/qr/utils.server", () => ({
  generateQrObj: vi.fn().mockResolvedValue({}),
}));

// why: reminders are a database read unrelated to the notice.
vi.mock("~/modules/asset-reminder/service.server", () => ({
  getRemindersForOverviewPage: vi.fn().mockResolvedValue([]),
}));

// why: the custody dialog's team members are a database read unrelated to
// the notice.
vi.mock("~/modules/team-member/service.server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getTeamMembersForQuantityCustody: vi
    .fn()
    .mockResolvedValue({ teamMembers: [], totalTeamMembers: 0 }),
}));

// why: the editor's custom field definitions are a database read unrelated to
// the notice.
vi.mock("~/modules/custom-field/service.server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getActiveCustomFields: vi.fn().mockResolvedValue([]),
}));

import { loader } from "~/routes/_layout+/assets.$assetId.overview";

/** A pool of ten units, nothing held in custody or kits. */
const TOTAL = 10;

/** Grants `roles` in a workspace with the audits add-on off. */
function grant(roles: OrganizationRoles[]) {
  const ctx = permissionContext({ roles });
  mockRequirePermission.mockResolvedValue({
    ...ctx,
    currentOrganization: { ...ctx.currentOrganization, auditsEnabled: false },
    canUseBarcodes: false,
  });
}

/**
 * Bookings ahead peak at `peak` units, and the biggest upcoming booking (a
 * colleague's) asks for six of them.
 */
function bookingsPeakAt(peak: number) {
  mockGetAssetAvailability.mockResolvedValue({
    total: TOTAL,
    inCustody: 0,
    inKits: 0,
    checkedOut: 0,
    reserved: peak,
    reservedTotal: peak,
    reservingBookingCount: 2,
    physicalAvailable: TOTAL,
  });
  db.bookingAsset.groupBy.mockResolvedValue([
    { bookingId: "booking-1", _sum: { quantity: 6 } },
  ]);
  db.booking.findFirst.mockResolvedValue({
    name: "Colleague's shoot",
    custodianUserId: "user-2",
    custodianTeamMember: { userId: "user-2" },
  });
}

/** Runs the loader for a viewer and returns its payload. */
async function load() {
  return (await loader({
    request: new Request("http://localhost/assets/asset-1/overview"),
    params: { assetId: "asset-1" },
    context: { getSession: () => ({ userId: "user-1" }) },
  } as unknown as Parameters<typeof loader>[0])) as unknown as {
    overCommitment: {
      shortBy: number;
      booking: { id: string; name: string; units: number } | null;
    } | null;
  };
}

describe("asset overview loader: over-commitment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    grant([OrganizationRoles.ADMIN]);
    mockGetAsset.mockResolvedValue({
      id: "asset-1",
      title: "Tripod",
      type: "QUANTITY_TRACKED",
      quantity: TOTAL,
      categoryId: null,
      customFields: [],
      assetLocations: [],
      custody: [],
    });
    db.location.findMany.mockResolvedValue([]);
    db.kit.findMany.mockResolvedValue([]);
  });

  it("does not read the booking when the pool is within its size", async () => {
    // Four units asked for out of ten: an upcoming booking exists, but no
    // notice renders, so nothing would show its name.
    bookingsPeakAt(4);

    const result = await load();

    expect(result.overCommitment).toBeNull();
    expect(db.booking.findFirst).not.toHaveBeenCalled();
  });

  it("names the biggest booking when the pool is over-committed", async () => {
    bookingsPeakAt(12);

    const result = await load();

    expect(db.booking.findFirst).toHaveBeenCalledTimes(1);
    expect(result.overCommitment).toMatchObject({
      shortBy: 2,
      booking: { id: "booking-1", name: "Colleague's shoot", units: 6 },
    });
  });

  it("states the shortfall without the booking to a viewer who may not open it", async () => {
    // BASE with every workspace toggle off sees only its own bookings, and the
    // booking here is a colleague's.
    grant([OrganizationRoles.BASE]);
    bookingsPeakAt(12);

    const result = await load();

    expect(result.overCommitment).toMatchObject({ shortBy: 2, booking: null });
    expect(JSON.stringify(result)).not.toContain("Colleague's shoot");
  });
});
