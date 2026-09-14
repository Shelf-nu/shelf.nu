/**
 * Contract tests for the mobile add-to-booking endpoint: how a scanned kit is
 * routed, what a scan is allowed to write twice, and what the response says
 * actually happened.
 *
 * A kit's members have to reach the booking as kit-driven slices, each naming
 * the `AssetKit` membership it came from. That membership is what
 * `BookingAsset.assetKitId` records and what every kit-grouped surface reads;
 * an asset added as a loose id has none, so the kit it was scanned as is lost
 * on the phone and on the website alike.
 *
 * The suite runs without a database, so the assertions are on the specs the
 * route hands the service — which is the seam where the provenance is either
 * carried or dropped — and on the reads it makes to decide them. Turning a
 * spec into a row with `assetKitId` and `sourceKitId` set is
 * `addScannedAssetsToBooking`'s own contract.
 *
 * @see {@link file://../../../../app/routes/api+/mobile+/bookings.add-scanned-assets.ts} route under test
 */

import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createActionArgs } from "@mocks/remix";

import { db } from "~/database/db.server";
import type * as MobileAuthServer from "~/modules/api/mobile-auth.server";
import {
  requireMobileAuth,
  requireOrganizationAccess,
  getMobileUserContext,
} from "~/modules/api/mobile-auth.server";
import type * as BookingServiceServer from "~/modules/booking/service.server";
import { addScannedAssetsToBooking } from "~/modules/booking/service.server";

import { action } from "~/routes/api+/mobile+/bookings.add-scanned-assets";

import { assertIsDataWithResponseInit } from "@helpers/assertions";
import { mobileUserContext } from "@helpers/mobile-user-context";

// @vitest-environment node

// why: db is the integration boundary. `booking.findFirst` is the org-scoped
// booking read, `bookingAsset.findMany` is the scoped read of the standalone
// rows a scan could duplicate, `assetKit.findMany` is what resolves a kit into
// its memberships, and `asset.findMany` backs the org guard on the scanned ids.
vi.mock("~/database/db.server", () => ({
  db: {
    booking: { findFirst: vi.fn() },
    bookingAsset: { findMany: vi.fn().mockResolvedValue([]) },
    assetKit: { findMany: vi.fn().mockResolvedValue([]) },
    asset: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

// why: JWT validation, org-membership resolution and the permission gate are
// out of scope; the rest of the module stays real.
vi.mock("~/modules/api/mobile-auth.server", async () => {
  const actual = await vi.importActual<typeof MobileAuthServer>(
    "~/modules/api/mobile-auth.server"
  );
  return {
    ...actual,
    requireMobileAuth: vi.fn(),
    requireOrganizationAccess: vi.fn(),
    requireMobilePermission: vi.fn(),
    assertMobileCanUseBookings: vi.fn(),
    getMobileUserContext: vi.fn(),
  };
});

// why: `addScannedAssetsToBooking` is the seam under test — spying on it is
// how the specs the route builds become observable. `buildKitSlicesForBooking`
// stays REAL: it is the piece that turns kit ids into memberships, and mocking
// it would test nothing.
vi.mock("~/modules/booking/service.server", async () => {
  const actual = await vi.importActual<typeof BookingServiceServer>(
    "~/modules/booking/service.server"
  );
  return {
    ...actual,
    addScannedAssetsToBooking: vi.fn().mockResolvedValue(undefined),
  };
});

// why: rate limiting is infra, not the behaviour under test — no-op it.
vi.mock("~/utils/rate-limit.server", () => ({
  enforceUserRateLimit: vi.fn().mockResolvedValue(undefined),
}));

const findFirstMock = vi.mocked(db.booking.findFirst);
const bookingAssetFindManyMock = vi.mocked(db.bookingAsset.findMany);
const assetKitFindManyMock = vi.mocked(db.assetKit.findMany);
const assetFindManyMock = vi.mocked(db.asset.findMany);
const addScannedAssetsToBookingMock = vi.mocked(addScannedAssetsToBooking);

const BOOKING_ID = "booking-1";

/**
 * A DRAFT booking already holding the given kit memberships. Only the
 * `AssetKit` ids are modelled: the booking read is scoped to kit-driven rows,
 * because the standalone half is read separately once the scan's asset set is
 * known.
 */
function bookingHoldsKitMemberships(assetKitIds: string[]) {
  findFirstMock.mockResolvedValue({
    id: BOOKING_ID,
    status: "DRAFT",
    from: new Date("2026-01-01T00:00:00.000Z"),
    to: new Date("2026-01-02T00:00:00.000Z"),
    custodianUserId: "user-1",
    bookingAssets: assetKitIds.map((assetKitId) => ({ assetKitId })),
  } as never);
}

/** Standalone rows the booking already holds for the assets being scanned. */
function bookingHoldsLoose(rows: { assetId: string; type?: string }[]) {
  bookingAssetFindManyMock.mockResolvedValue(
    rows.map(({ assetId, type }) => ({
      assetId,
      asset: { type: type ?? "INDIVIDUAL" },
    })) as never
  );
}

/** The scanned assets exist in this org, so the org guard passes. */
function assetsExist(ids: string[]) {
  assetFindManyMock.mockResolvedValue(ids.map((id) => ({ id })) as never);
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
  addScannedAssetsToBookingMock.mockResolvedValue(undefined as never);
  // An empty booking that nothing has been scanned onto — each test states
  // only what it needs the booking to already hold.
  bookingHoldsKitMemberships([]);
  bookingHoldsLoose([]);
  assetsExist([]);
  assetKitFindManyMock.mockResolvedValue([] as never);
});

async function post(body: Record<string, unknown>) {
  return action(
    createActionArgs({
      request: new Request(
        "http://localhost:3000/api/mobile/bookings/add-scanned-assets",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ bookingId: BOOKING_ID, ...body }),
        }
      ),
      params: {},
    })
  );
}

/** The one call the route made into the service. */
function serviceCall() {
  expect(addScannedAssetsToBookingMock).toHaveBeenCalledTimes(1);
  return addScannedAssetsToBookingMock.mock.calls[0][0];
}

/** The 200 body, typed as the route documents it. */
function successBody(response: unknown) {
  assertIsDataWithResponseInit(response);
  expect(response.init?.status ?? 200).toBe(200);
  return response.data as {
    success: boolean;
    added: { assets: number; kitSlices: number; kits: number };
    skipped: { assets: number; kits: number };
  };
}

describe("POST /api/mobile/bookings/add-scanned-assets — kit provenance", () => {
  it("adds a scanned kit's members as kit-driven slices, not loose assets", async () => {
    assetKitFindManyMock.mockResolvedValue([
      { id: "ak1", assetId: "asset-1", quantity: 1, kitId: "kit-1" },
      { id: "ak2", assetId: "asset-2", quantity: 3, kitId: "kit-1" },
    ] as never);

    const response = await post({ kitIds: ["kit-1"] });

    assertIsDataWithResponseInit(response);
    expect(response.init?.status ?? 200).toBe(200);

    const call = serviceCall();
    // Each slice names the membership it came from — the value that becomes
    // `BookingAsset.assetKitId` — plus the kit behind it for `sourceKitId`.
    expect(call.kitSlices).toEqual([
      { assetId: "asset-1", assetKitId: "ak1", kitId: "kit-1", quantity: 1 },
      { assetId: "asset-2", assetKitId: "ak2", kitId: "kit-1", quantity: 3 },
    ]);
    // Nothing goes through the loose bucket, which is what would have stripped
    // the membership.
    expect(call.assetIds).toEqual([]);
    // The kit id still travels for the status flags and the kit-level note.
    expect(call.kitIds).toEqual(["kit-1"]);
  });

  it("scopes the membership lookup to the caller's organization", async () => {
    await post({ kitIds: ["kit-from-another-org"] });

    expect(assetKitFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          kitId: { in: ["kit-from-another-org"] },
          organizationId: "org-1",
        },
      })
    );
    expect(serviceCall().kitSlices).toEqual([]);
  });

  it("leaves a standalone scan standalone", async () => {
    assetsExist(["asset-9"]);

    await post({ assetIds: ["asset-9"] });

    const call = serviceCall();
    expect(call.assetIds).toEqual(["asset-9"]);
    expect(call.kitSlices).toEqual([]);
    // No kit was scanned, so no membership lookup is worth a round trip.
    expect(assetKitFindManyMock).not.toHaveBeenCalled();
  });

  it("lets the kit claim an asset scanned both on its own and via its kit", async () => {
    // Scanning the asset and then its kit must not book it twice. The kit
    // slice is the more specific of the two, so the loose scan drops.
    assetsExist(["asset-1"]);
    assetKitFindManyMock.mockResolvedValue([
      { id: "ak1", assetId: "asset-1", quantity: 1, kitId: "kit-1" },
    ] as never);

    await post({ assetIds: ["asset-1"], kitIds: ["kit-1"] });

    const call = serviceCall();
    expect(call.assetIds).toEqual([]);
    expect(call.kitSlices).toEqual([
      { assetId: "asset-1", assetKitId: "ak1", kitId: "kit-1", quantity: 1 },
    ]);
  });

  it("sends one standalone id even when the caller repeats it", async () => {
    // One standalone row is written per id, and a second row for the same
    // asset breaks the partial unique on `(bookingId, assetId)`.
    assetsExist(["asset-9"]);
    assetKitFindManyMock.mockResolvedValue([
      { id: "ak1", assetId: "asset-1", quantity: 1, kitId: "kit-1" },
    ] as never);

    await post({ assetIds: ["asset-9", "asset-9"], kitIds: ["kit-1"] });

    const call = serviceCall();
    expect(call.assetIds).toEqual(["asset-9"]);
    expect(call.kitSlices).toHaveLength(1);
  });

  it("will not book an individual asset a second time through its kit", async () => {
    // The asset is already on the booking loose. The two partial uniques would
    // happily accept a kit-driven row beside it, leaving the booking holding
    // one physical asset twice.
    bookingHoldsLoose([{ assetId: "asset-1", type: "INDIVIDUAL" }]);
    assetKitFindManyMock.mockResolvedValue([
      { id: "ak1", assetId: "asset-1", quantity: 1, kitId: "kit-1" },
      { id: "ak2", assetId: "asset-2", quantity: 1, kitId: "kit-1" },
    ] as never);

    await post({ kitIds: ["kit-1"] });

    const call = serviceCall();
    expect(call.kitSlices).toEqual([
      { assetId: "asset-2", assetKitId: "ak2", kitId: "kit-1", quantity: 1 },
    ]);
  });

  it("still books a quantity-tracked asset through its kit alongside a loose row", async () => {
    // Units of a quantity-tracked asset can legitimately sit in the free pool
    // and in a kit at once, so the guard above must not catch it.
    bookingHoldsLoose([{ assetId: "asset-1", type: "QUANTITY_TRACKED" }]);
    assetKitFindManyMock.mockResolvedValue([
      { id: "ak1", assetId: "asset-1", quantity: 4, kitId: "kit-1" },
    ] as never);

    await post({ kitIds: ["kit-1"] });

    expect(serviceCall().kitSlices).toEqual([
      { assetId: "asset-1", assetKitId: "ak1", kitId: "kit-1", quantity: 4 },
    ]);
  });

  it("does not claim a kit was added when every member was already there", async () => {
    // `kitIds` is what the note is written from, so naming a kit that put
    // nothing on the booking records an addition that never happened.
    bookingHoldsKitMemberships(["ak1"]);
    assetKitFindManyMock.mockResolvedValue([
      { id: "ak1", assetId: "asset-1", quantity: 1, kitId: "kit-1" },
    ] as never);

    await post({ kitIds: ["kit-1"] });

    const call = serviceCall();
    expect(call.kitSlices).toEqual([]);
    expect(call.kitIds).toEqual([]);
  });

  it("adds only the members a partly-present kit is still missing", async () => {
    // Re-adding a kit the booking already holds part of must top it up, not
    // collide with the rows already there.
    bookingHoldsKitMemberships(["ak1"]);
    assetKitFindManyMock.mockResolvedValue([
      { id: "ak1", assetId: "asset-1", quantity: 1, kitId: "kit-1" },
      { id: "ak2", assetId: "asset-2", quantity: 1, kitId: "kit-1" },
    ] as never);

    await post({ kitIds: ["kit-1"] });

    expect(serviceCall().kitSlices).toEqual([
      { assetId: "asset-2", assetKitId: "ak2", kitId: "kit-1", quantity: 1 },
    ]);
  });
});

describe("POST /api/mobile/bookings/add-scanned-assets — re-scanning what is already there", () => {
  it("does not write a second standalone row for an asset the booking already holds", async () => {
    // The picker lists assets this booking has already reserved and flags none
    // of them, so ticking one is ordinary. Handing the id to the service would
    // write a duplicate standalone row and fail the partial unique.
    assetsExist(["asset-9"]);
    bookingHoldsLoose([{ assetId: "asset-9" }]);

    const response = await post({ assetIds: ["asset-9"] });

    expect(serviceCall().assetIds).toEqual([]);
    expect(successBody(response).added.assets).toBe(0);
  });

  it("drops a quantity-tracked re-scan too, since a scan carries no quantity", async () => {
    // A second row would be worth one more unit, which is not what re-scanning
    // an asset asks for; changing the held quantity is a separate control.
    assetsExist(["asset-9"]);
    bookingHoldsLoose([{ assetId: "asset-9", type: "QUANTITY_TRACKED" }]);

    await post({ assetIds: ["asset-9"] });

    expect(serviceCall().assetIds).toEqual([]);
  });

  it("still adds the assets of the same scan that are not on the booking yet", async () => {
    assetsExist(["asset-8", "asset-9"]);
    bookingHoldsLoose([{ assetId: "asset-9" }]);

    const response = await post({ assetIds: ["asset-8", "asset-9"] });

    expect(serviceCall().assetIds).toEqual(["asset-8"]);
    const body = successBody(response);
    expect(body.added.assets).toBe(1);
    expect(body.skipped.assets).toBe(1);
  });
});

describe("POST /api/mobile/bookings/add-scanned-assets — what the response reports", () => {
  it("reports what a scan put on the booking", async () => {
    assetsExist(["asset-9"]);
    assetKitFindManyMock.mockResolvedValue([
      { id: "ak1", assetId: "asset-1", quantity: 1, kitId: "kit-1" },
      { id: "ak2", assetId: "asset-2", quantity: 1, kitId: "kit-1" },
    ] as never);

    const response = await post({ assetIds: ["asset-9"], kitIds: ["kit-1"] });

    expect(successBody(response)).toEqual({
      success: true,
      added: { assets: 1, kitSlices: 2, kits: 1 },
      skipped: { assets: 0, kits: 0 },
    });
  });

  it("reports zero added when every scanned item was already on the booking", async () => {
    // The request succeeded and nothing failed, so this is a 200 — but the
    // booking did not change, and a client that only reads `success` would
    // tell the user it did.
    assetsExist(["asset-9"]);
    bookingHoldsLoose([{ assetId: "asset-9" }]);
    bookingHoldsKitMemberships(["ak1"]);
    assetKitFindManyMock.mockResolvedValue([
      { id: "ak1", assetId: "asset-1", quantity: 1, kitId: "kit-1" },
    ] as never);

    const response = await post({ assetIds: ["asset-9"], kitIds: ["kit-1"] });

    expect(successBody(response)).toEqual({
      success: true,
      added: { assets: 0, kitSlices: 0, kits: 0 },
      skipped: { assets: 1, kits: 1 },
    });
  });

  it("does not count an asset a kit claimed as skipped", async () => {
    // It reached the booking as a kit-driven slice, which is what the scan
    // asked for — reporting it as skipped would read as a failure.
    assetsExist(["asset-1"]);
    assetKitFindManyMock.mockResolvedValue([
      { id: "ak1", assetId: "asset-1", quantity: 1, kitId: "kit-1" },
    ] as never);

    const response = await post({ assetIds: ["asset-1"], kitIds: ["kit-1"] });

    const body = successBody(response);
    expect(body.added).toEqual({ assets: 0, kitSlices: 1, kits: 1 });
    expect(body.skipped).toEqual({ assets: 0, kits: 0 });
  });
});

describe("POST /api/mobile/bookings/add-scanned-assets — reads are scoped to the scan", () => {
  it("reads only the booking's kit-driven rows, never its whole contents", async () => {
    await post({ kitIds: ["kit-1"] });

    const select = findFirstMock.mock.calls[0][0]?.select as {
      bookingAssets: { where: unknown; select: unknown };
    };
    expect(select.bookingAssets.where).toEqual({ assetKitId: { not: null } });
    expect(select.bookingAssets.select).toEqual({ assetKitId: true });
  });

  it("reads standalone rows only for the assets the scan touches", async () => {
    // Every member a scanned kit resolved to belongs to the scan's asset set,
    // alongside the ids scanned directly.
    assetsExist(["asset-9"]);
    assetKitFindManyMock.mockResolvedValue([
      { id: "ak1", assetId: "asset-1", quantity: 1, kitId: "kit-1" },
    ] as never);

    await post({ assetIds: ["asset-9"], kitIds: ["kit-1"] });

    expect(bookingAssetFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          bookingId: BOOKING_ID,
          assetKitId: null,
          assetId: { in: ["asset-9", "asset-1"] },
        },
      })
    );
  });

  it("skips the standalone read when the scan resolves to no assets at all", async () => {
    bookingHoldsKitMemberships(["ak1"]);
    assetKitFindManyMock.mockResolvedValue([
      { id: "ak1", assetId: "asset-1", quantity: 1, kitId: "kit-1" },
    ] as never);

    await post({ kitIds: ["kit-1"] });

    expect(bookingAssetFindManyMock).not.toHaveBeenCalled();
  });
});
