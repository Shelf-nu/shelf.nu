/**
 * Response-contract test for the two unit counters the mobile booking detail
 * endpoint sends on every quantity-tracked row, and for the check-in flag that
 * reads them.
 *
 * The phone cannot decide check-in from `remainingToCheckIn`. That counter is
 * booked minus dispositioned, so a row nothing was ever checked out for reads
 * as fully outstanding, and `partialCheckinBooking` then refuses it with
 * "Cannot check in assets that were never checked out". `dispatchedUnitsTotal`
 * and `dispositionedUnitsTotal` are what let it ask the right question, and
 * `canCheckin` has to answer that same question or the app offers a one-tap
 * check-in the server declines.
 *
 * What this pins:
 * 1. Units sent out come from BOTH records, because neither alone is enough:
 *    the all-at-once checkout stamps a slice and writes no checkout session,
 *    while a progressive scan writes a session.
 * 2. Dispositioned units are the per-slice attribution summed over the asset.
 * 3. `canCheckin` is false when every row is booked but nothing went out, and
 *    true as soon as one row has units out.
 * 4. `remainingToCheckIn` / `remainingToCheckOut` keep their old values, which
 *    app bundles already in the field read.
 *
 * @see {@link file://./../../../../app/routes/api+/mobile+/bookings.$bookingId.ts} loader under test
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
import type * as BookingServiceServer from "~/modules/booking/service.server";
import {
  computeBookingAssetRemaining,
  computeBookingAssetRemainingToCheckOut,
} from "~/modules/booking/service.server";

import { loader } from "~/routes/api+/mobile+/bookings.$bookingId";

import { assertIsDataWithResponseInit } from "@helpers/assertions";
import { mobileUserContext } from "@helpers/mobile-user-context";

// @vitest-environment node

// why: db is the integration boundary. The booking row, the slice rows (which
// carry the stored per-slice unit counter and the departure markers), the
// checkout sessions and the disposition logs are all fixtures here — they are
// the inputs the counters under test are derived from. `asset` and
// `assetLocation` answer the check-out "From location" read with no
// placements, so no pool here asks.
vi.mock("~/database/db.server", () => ({
  db: {
    booking: { findFirst: vi.fn() },
    bookingAsset: { findMany: vi.fn().mockResolvedValue([]) },
    asset: { findMany: vi.fn().mockResolvedValue([]) },
    assetLocation: { findMany: vi.fn().mockResolvedValue([]) },
    partialBookingCheckout: { findMany: vi.fn().mockResolvedValue([]) },
    consumptionLog: { findMany: vi.fn().mockResolvedValue([]) },
    kit: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

// why: JWT validation and org-membership resolution are out of scope; the
// caller is a fixed ADMIN so the permission half of `canCheckin` is not the
// variable under test.
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

// why: the two `remaining` helpers issue their own reads through a client this
// suite has no database for. Their values are fixtures, and each case states
// what it wants them to be — they are the OLD counters, kept unchanged, and
// part of what this test pins.
vi.mock("~/modules/booking/service.server", async () => {
  const actual = await vi.importActual<typeof BookingServiceServer>(
    "~/modules/booking/service.server"
  );
  return {
    ...actual,
    computeBookingAssetRemaining: vi.fn().mockResolvedValue(0),
    computeBookingAssetRemainingToCheckOut: vi.fn().mockResolvedValue(0),
    getDetailedPartialCheckinData: vi
      .fn()
      .mockResolvedValue({ checkedInAssetIds: [], partialCheckinDetails: {} }),
  };
});

// why: fixed booking settings isolate quantity eligibility from the
// explicit-check-in policy and from kit counting, neither of which is under
// test here.
vi.mock("~/modules/booking-settings/service.server", () => ({
  getBookingSettingsForOrganization: vi.fn().mockResolvedValue({
    requireExplicitCheckinForAdmin: false,
    requireExplicitCheckinForSelfService: false,
    countKitsAsSingleUnit: false,
  }),
}));

// why: `canCheckin` is state AND permission. A fixed `true` isolates the state
// half, which is what this test changes.
vi.mock("~/utils/permissions/permission.validator.server", () => ({
  hasPermission: vi.fn().mockResolvedValue(true),
}));

const KIT = { id: "kit-1", name: "Cable Kit" };

/** One quantity-tracked kit member, booked `quantity` units. */
function bookingAssetRow(assetId: string, quantity: number) {
  return {
    id: `ba-${assetId}`,
    quantity,
    assetKitId: "ak-1",
    asset: {
      id: assetId,
      title: `Asset ${assetId}`,
      status: "AVAILABLE",
      type: "QUANTITY_TRACKED",
      unitOfMeasure: "pcs",
      consumptionType: "TWO_WAY",
      mainImage: null,
      category: null,
      assetKits: [{ id: "ak-1", kit: KIT }],
    },
  };
}

/**
 * A slice row as the loader reads it. `unitsOut` is the stored cumulative
 * counter; `stamped` is the departure marker the all-at-once checkout writes.
 */
function sliceRow(
  assetId: string,
  quantity: number,
  {
    unitsOut = 0,
    stamped = false,
  }: { unitsOut?: number; stamped?: boolean } = {}
) {
  return {
    id: `ba-${assetId}`,
    assetId,
    quantity,
    assetKitId: "ak-1",
    checkedOutAt: stamped ? new Date("2026-01-01T10:00:00.000Z") : null,
    checkedInAt: null,
    checkedOutQuantity: unitsOut,
  };
}

/** An ONGOING booking holding `rows`. */
function bookingRow(rows: ReturnType<typeof bookingAssetRow>[]) {
  return {
    id: "booking-1",
    name: "Shoot",
    description: null,
    status: "ONGOING",
    from: new Date("2026-01-01T00:00:00.000Z"),
    to: new Date("2026-01-02T00:00:00.000Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    creator: null,
    custodianUser: null,
    custodianTeamMember: null,
    tags: [],
    bookingAssets: rows,
    modelRequests: [],
    _count: { bookingAssets: rows.length },
  } as never;
}

type ResponseAsset = {
  id: string;
  dispatchedUnitsTotal?: number;
  dispositionedUnitsTotal?: number;
  remainingToCheckIn?: number;
  remainingToCheckOut?: number;
};

async function readBooking() {
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
    booking: { assets: ResponseAsset[] };
    canCheckin: boolean;
    canCheckinAll: boolean;
  };
  return {
    canCheckin: body.canCheckin,
    canCheckinAll: body.canCheckinAll,
    assetById: new Map(body.booking.assets.map((a) => [a.id, a])),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireMobileAuth).mockResolvedValue({
    user: { id: "user-1" },
  } as Awaited<ReturnType<typeof requireMobileAuth>>);
  vi.mocked(requireOrganizationAccess).mockResolvedValue("org-1");
  vi.mocked(getMobileUserContext).mockResolvedValue(
    mobileUserContext({ roles: [OrganizationRoles.ADMIN] })
  );
  vi.mocked(computeBookingAssetRemaining).mockResolvedValue(0);
  vi.mocked(computeBookingAssetRemainingToCheckOut).mockResolvedValue(0);
  vi.mocked(db.bookingAsset.findMany).mockResolvedValue([]);
  vi.mocked(db.partialBookingCheckout.findMany).mockResolvedValue([]);
  vi.mocked(db.consumptionLog.findMany).mockResolvedValue([]);
});

describe("GET /api/mobile/bookings/:bookingId — units out per quantity row", () => {
  it("sends zero units out for a row nothing was ever checked out for", async () => {
    // The reported bug's shape: 4 booked, no departure of any kind. The old
    // counter says 4 still to check in, which is what drew a tick box.
    vi.mocked(db.booking.findFirst).mockResolvedValue(
      bookingRow([bookingAssetRow("asset-a", 4)])
    );
    vi.mocked(db.bookingAsset.findMany).mockResolvedValue([
      sliceRow("asset-a", 4),
    ] as never);
    vi.mocked(computeBookingAssetRemaining).mockResolvedValue(4);
    vi.mocked(computeBookingAssetRemainingToCheckOut).mockResolvedValue(4);

    const { assetById, canCheckin } = await readBooking();
    const row = assetById.get("asset-a");

    expect(row?.dispatchedUnitsTotal).toBe(0);
    expect(row?.dispositionedUnitsTotal).toBe(0);
    // Unchanged, and exactly why it cannot be the check-in test.
    expect(row?.remainingToCheckIn).toBe(4);
    expect(row?.remainingToCheckOut).toBe(4);
    expect(canCheckin).toBe(false);
  });

  it("counts the units a progressive check-out session recorded", async () => {
    vi.mocked(db.booking.findFirst).mockResolvedValue(
      bookingRow([bookingAssetRow("asset-a", 4)])
    );
    vi.mocked(db.bookingAsset.findMany).mockResolvedValue([
      sliceRow("asset-a", 4, { unitsOut: 2, stamped: true }),
    ] as never);
    vi.mocked(db.partialBookingCheckout.findMany).mockResolvedValue([
      {
        assetIds: ["asset-a"],
        quantities: [2],
        bookingAssetIds: ["ba-asset-a"],
      },
    ] as never);
    vi.mocked(computeBookingAssetRemaining).mockResolvedValue(4);
    vi.mocked(computeBookingAssetRemainingToCheckOut).mockResolvedValue(2);

    const { assetById, canCheckin } = await readBooking();
    const row = assetById.get("asset-a");

    expect(row?.dispatchedUnitsTotal).toBe(2);
    expect(row?.dispositionedUnitsTotal).toBe(0);
    expect(canCheckin).toBe(true);
  });

  it("counts an all-at-once check-out, which writes no session row", async () => {
    // The regression this guards: reading the sessions alone would report 0
    // units out for a kit that is entirely in the field, and the phone would
    // then refuse to check it back in.
    vi.mocked(db.booking.findFirst).mockResolvedValue(
      bookingRow([bookingAssetRow("asset-a", 5)])
    );
    vi.mocked(db.bookingAsset.findMany).mockResolvedValue([
      sliceRow("asset-a", 5, { unitsOut: 5, stamped: true }),
    ] as never);
    vi.mocked(computeBookingAssetRemaining).mockResolvedValue(5);
    vi.mocked(computeBookingAssetRemainingToCheckOut).mockResolvedValue(0);

    const { assetById, canCheckin } = await readBooking();

    expect(db.partialBookingCheckout.findMany).toHaveBeenCalled();
    expect(assetById.get("asset-a")?.dispatchedUnitsTotal).toBe(5);
    expect(canCheckin).toBe(true);
  });

  it("subtracts what has come back", async () => {
    vi.mocked(db.booking.findFirst).mockResolvedValue(
      bookingRow([bookingAssetRow("asset-a", 2)])
    );
    vi.mocked(db.bookingAsset.findMany).mockResolvedValue([
      sliceRow("asset-a", 2, { unitsOut: 2, stamped: true }),
    ] as never);
    vi.mocked(db.consumptionLog.findMany).mockResolvedValue([
      {
        assetId: "asset-a",
        bookingAssetId: "ba-asset-a",
        category: "RETURN",
        quantity: 2,
      },
    ] as never);
    vi.mocked(computeBookingAssetRemaining).mockResolvedValue(0);
    vi.mocked(computeBookingAssetRemainingToCheckOut).mockResolvedValue(0);

    const { assetById, canCheckin } = await readBooking();
    const row = assetById.get("asset-a");

    expect(row?.dispatchedUnitsTotal).toBe(2);
    expect(row?.dispositionedUnitsTotal).toBe(2);
    // Out and back again: nothing left, so no one-tap check-in.
    expect(canCheckin).toBe(false);
  });

  it("counts returns from every trip, not just one booked quantity", async () => {
    // A row can go out, come back and go out again while the booking is still
    // ongoing, so the counters have to measure the whole booking. The stored
    // departure counter is cumulative; the returns have to be too. Reading the
    // per-slice attribution instead caps them at one booked quantity, and a
    // fully reconciled row would keep reading as 4 units out.
    vi.mocked(db.booking.findFirst).mockResolvedValue(
      bookingRow([bookingAssetRow("asset-a", 4)])
    );
    vi.mocked(db.bookingAsset.findMany).mockResolvedValue([
      sliceRow("asset-a", 4, { unitsOut: 8, stamped: true }),
    ] as never);
    // Untagged, which is the shape the companion sends: the check-in names the
    // asset, not the slice.
    vi.mocked(db.consumptionLog.findMany).mockResolvedValue([
      {
        assetId: "asset-a",
        bookingAssetId: null,
        category: "RETURN",
        quantity: 4,
      },
      {
        assetId: "asset-a",
        bookingAssetId: null,
        category: "RETURN",
        quantity: 4,
      },
    ] as never);
    vi.mocked(computeBookingAssetRemaining).mockResolvedValue(0);
    vi.mocked(computeBookingAssetRemainingToCheckOut).mockResolvedValue(0);

    const { assetById, canCheckin } = await readBooking();
    const row = assetById.get("asset-a");

    expect(row?.dispatchedUnitsTotal).toBe(8);
    expect(row?.dispositionedUnitsTotal).toBe(8);
    expect(canCheckin).toBe(false);
  });

  it("does not offer a second trip the endpoint's cap cannot accept", async () => {
    vi.mocked(db.booking.findFirst).mockResolvedValue(
      bookingRow([bookingAssetRow("asset-a", 4)])
    );
    vi.mocked(db.bookingAsset.findMany).mockResolvedValue([
      sliceRow("asset-a", 4, { unitsOut: 8, stamped: true }),
    ] as never);
    vi.mocked(db.consumptionLog.findMany).mockResolvedValue([
      {
        assetId: "asset-a",
        bookingAssetId: null,
        category: "RETURN",
        quantity: 4,
      },
    ] as never);
    // `partialCheckinBooking` caps every claim at booked minus everything
    // dispositioned, which is already zero here, so the 4 units of the second
    // trip cannot be checked in however they are counted. Offering them would
    // be this PR's own fault in the other direction.
    vi.mocked(computeBookingAssetRemaining).mockResolvedValue(0);
    vi.mocked(computeBookingAssetRemainingToCheckOut).mockResolvedValue(0);

    const { assetById, canCheckin } = await readBooking();
    const row = assetById.get("asset-a");

    expect(row?.dispatchedUnitsTotal).toBe(8);
    expect(row?.dispositionedUnitsTotal).toBe(4);
    expect(row?.remainingToCheckIn).toBe(0);
    expect(canCheckin).toBe(false);
  });

  it("offers check-in when one row has units out beside a never-dispatched one", async () => {
    vi.mocked(db.booking.findFirst).mockResolvedValue(
      bookingRow([bookingAssetRow("asset-a", 4), bookingAssetRow("asset-b", 4)])
    );
    vi.mocked(db.bookingAsset.findMany).mockResolvedValue([
      sliceRow("asset-a", 4),
      sliceRow("asset-b", 4, { unitsOut: 1, stamped: true }),
    ] as never);
    // Asset B went out one unit at a time, so it carries a session row. A
    // stamped slice WITHOUT one is an all-at-once departure and counts for its
    // whole booked quantity, which is the case the test above covers.
    vi.mocked(db.partialBookingCheckout.findMany).mockResolvedValue([
      {
        assetIds: ["asset-b"],
        quantities: [1],
        bookingAssetIds: ["ba-asset-b"],
      },
    ] as never);
    vi.mocked(computeBookingAssetRemaining).mockResolvedValue(4);
    vi.mocked(computeBookingAssetRemainingToCheckOut).mockResolvedValue(4);

    const { assetById, canCheckin } = await readBooking();

    expect(assetById.get("asset-a")?.dispatchedUnitsTotal).toBe(0);
    expect(assetById.get("asset-b")?.dispatchedUnitsTotal).toBe(1);
    expect(canCheckin).toBe(true);
  });

  it("counts a stamped slice whose stored counter is zero", async () => {
    // The departure marker and the stored counter are separate records, and
    // the marker alone has to answer: a slice stamped with nothing recorded
    // against it went out in full. Without this the units-out figure would
    // collapse to the stored counter and the row would lose its check-in.
    vi.mocked(db.booking.findFirst).mockResolvedValue(
      bookingRow([bookingAssetRow("asset-a", 5)])
    );
    vi.mocked(db.bookingAsset.findMany).mockResolvedValue([
      sliceRow("asset-a", 5, { unitsOut: 0, stamped: true }),
    ] as never);
    vi.mocked(computeBookingAssetRemaining).mockResolvedValue(5);
    vi.mocked(computeBookingAssetRemainingToCheckOut).mockResolvedValue(0);

    const { assetById, canCheckin } = await readBooking();

    expect(assetById.get("asset-a")?.dispatchedUnitsTotal).toBe(5);
    expect(canCheckin).toBe(true);
  });
});

describe("GET /api/mobile/bookings/:bookingId — the two check-in offers", () => {
  it("still offers the quick check-in when nothing ever went out", async () => {
    // `checkinBooking` completes a booking whatever went out, and the web
    // offers it on any active booking, so the phone has to as well — otherwise
    // a booking whose rows were all added after check-out closes from a
    // browser and from nowhere on the phone.
    vi.mocked(db.booking.findFirst).mockResolvedValue(
      bookingRow([bookingAssetRow("asset-a", 4)])
    );
    vi.mocked(db.bookingAsset.findMany).mockResolvedValue([
      sliceRow("asset-a", 4),
    ] as never);
    vi.mocked(computeBookingAssetRemaining).mockResolvedValue(4);
    vi.mocked(computeBookingAssetRemainingToCheckOut).mockResolvedValue(4);

    const { canCheckin, canCheckinAll } = await readBooking();

    // The scan and select paths submit to `partialCheckinBooking`, which
    // refuses every row on this booking.
    expect(canCheckin).toBe(false);
    expect(canCheckinAll).toBe(true);
  });

  it("offers both when units are out", async () => {
    vi.mocked(db.booking.findFirst).mockResolvedValue(
      bookingRow([bookingAssetRow("asset-a", 4)])
    );
    vi.mocked(db.bookingAsset.findMany).mockResolvedValue([
      sliceRow("asset-a", 4, { unitsOut: 2, stamped: true }),
    ] as never);
    vi.mocked(computeBookingAssetRemaining).mockResolvedValue(4);
    vi.mocked(computeBookingAssetRemainingToCheckOut).mockResolvedValue(2);

    const { canCheckin, canCheckinAll } = await readBooking();

    expect(canCheckin).toBe(true);
    expect(canCheckinAll).toBe(true);
  });
});
