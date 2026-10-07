// @vitest-environment node
/**
 * Asset page loader: the booking rows behind the header status badge.
 *
 * The header `AssetStatusBadge` reads `asset.bookingAssets` straight from this
 * loader, so for a QUANTITY_TRACKED asset each ONGOING / OVERDUE row must carry
 * the units still off the shelf on that booking, not the units booked. These
 * tests run the real still-out accounting (`booking/checked-out.server`) over an
 * in-memory client, so they fail if the route stops feeding it in.
 *
 * INDIVIDUAL assets never read those rows (their badge asks
 * `/api/assets/:id/ongoing-booking` instead), so the loader must not pay for
 * the still-out reads on them.
 *
 * @see {@link file://../../../app/routes/_layout+/assets.$assetId.tsx}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getAsset,
  requirePermission,
  getTeamMembersForQuantityCustody,
  getCustodySourceSummary,
  db,
} = vi.hoisted(() => ({
  getAsset: vi.fn(),
  requirePermission: vi.fn(),
  getTeamMembersForQuantityCustody: vi.fn(),
  getCustodySourceSummary: vi.fn(),
  db: {
    bookingAsset: { findMany: vi.fn() },
    partialBookingCheckout: { findMany: vi.fn() },
    consumptionLog: { findMany: vi.fn() },
  },
}));

// why: authorization is not under test here; the stub hands back an org scope.
vi.mock("~/utils/roles.server", () => ({ requirePermission }));

// why: `getAsset` is a large DB read; the test supplies the asset row it returns.
vi.mock("~/modules/asset/service.server", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getAsset,
}));

// why: DB reads for the custody dialogs, unrelated to the badge rows. Stubbed
// so the tests can also observe whether they run alongside the still-out read.
vi.mock("~/modules/team-member/service.server", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getTeamMembersForQuantityCustody,
}));
vi.mock("~/modules/asset/custody-source.server", () => ({
  getCustodySourceSummary,
}));

// why: the still-out accounting reads through `db`. An in-memory client keeps
// the real arithmetic under test without a database.
vi.mock("~/database/db.server", () => ({ db }));

import { loader } from "~/routes/_layout+/assets.$assetId";

/** Minimal loader args for `/assets/asset-1`. */
function loaderArgs() {
  return {
    context: { getSession: () => ({ userId: "user-1" }) },
    request: new Request("http://localhost/assets/asset-1"),
    params: { assetId: "asset-1" },
  } as unknown as Parameters<typeof loader>[0];
}

const ongoingBooking = { id: "b1", name: "Field shoot", status: "ONGOING" };

/** A QUANTITY_TRACKED asset with 10 units booked on one ongoing booking. */
function quantityTrackedAsset() {
  return {
    id: "asset-1",
    title: "Tripod",
    type: "QUANTITY_TRACKED",
    quantity: 20,
    custody: [],
    assetKits: [],
    bookingAssets: [
      { quantity: 10, assetKitId: null, booking: ongoingBooking },
    ],
  };
}

/** Points the in-memory client at: 10 booked and sent out, 4 checked back in. */
function tenOutFourReturned() {
  db.bookingAsset.findMany.mockResolvedValue([
    {
      id: "slice-1",
      quantity: 10,
      assetKitId: null,
      bookingId: "b1",
      checkedOutAt: new Date("2026-10-01T09:00:00Z"),
      checkedOutQuantity: 10,
    },
  ]);
  db.partialBookingCheckout.findMany.mockResolvedValue([]);
  db.consumptionLog.findMany.mockResolvedValue([
    { bookingId: "b1", bookingAssetId: "slice-1", quantity: 4 },
  ]);
}

describe("asset page loader: header badge booking rows", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requirePermission.mockResolvedValue({
      organizationId: "org-1",
      userOrganizations: [],
      // why: the slice of the role policy this loader reads (custody redaction).
      access: { custody: { seeAll: true } },
    });
    getTeamMembersForQuantityCustody.mockResolvedValue({
      teamMembers: [],
      totalTeamMembers: 0,
    });
    db.bookingAsset.findMany.mockResolvedValue([]);
    db.partialBookingCheckout.findMany.mockResolvedValue([]);
    db.consumptionLog.findMany.mockResolvedValue([]);
    getCustodySourceSummary.mockResolvedValue({
      multiSource: false,
      options: [],
      poolAvailable: 20,
    });
  });

  it("gives an ongoing booking the units still out, not the units booked", async () => {
    getAsset.mockResolvedValue(quantityTrackedAsset());
    tenOutFourReturned();

    const result = await loader(loaderArgs());

    expect(result.asset.bookingAssets).toEqual([
      { quantity: 6, assetKitId: null, booking: ongoingBooking },
    ]);
  });

  it("does not read still-out units for an INDIVIDUAL asset", async () => {
    getAsset.mockResolvedValue({
      id: "asset-1",
      title: "Camera",
      type: "INDIVIDUAL",
      quantity: null,
      custody: null,
      assetKits: [],
      bookingAssets: [
        { quantity: 1, assetKitId: null, booking: ongoingBooking },
      ],
    });

    await loader(loaderArgs());

    expect(db.bookingAsset.findMany).not.toHaveBeenCalled();
    expect(db.partialBookingCheckout.findMany).not.toHaveBeenCalled();
    expect(db.consumptionLog.findMany).not.toHaveBeenCalled();
  });

  it("starts the still-out read and the custody-dialog reads together", async () => {
    getAsset.mockResolvedValue(quantityTrackedAsset());
    tenOutFourReturned();

    // Hold the team-member read open. If the loader awaited it before starting
    // the others, they would not have been called yet.
    let releaseTeamMembers!: () => void;
    getTeamMembersForQuantityCustody.mockReturnValue(
      new Promise((resolve) => {
        releaseTeamMembers = () =>
          resolve({ teamMembers: [], totalTeamMembers: 0 });
      })
    );

    const pending = loader(loaderArgs());
    await vi.waitFor(() =>
      expect(getTeamMembersForQuantityCustody).toHaveBeenCalled()
    );

    expect(db.bookingAsset.findMany).toHaveBeenCalled();
    expect(getCustodySourceSummary).toHaveBeenCalled();

    releaseTeamMembers();
    await pending;
  });
});
