/**
 * Contract test for how the mobile add-to-booking endpoint routes a scanned
 * kit.
 *
 * A kit's members have to reach the booking as kit-driven slices, each naming
 * the `AssetKit` membership it came from. That membership is what
 * `BookingAsset.assetKitId` records and what every kit-grouped surface reads;
 * an asset added as a loose id has none, so the kit it was scanned as is lost
 * on the phone and on the website alike.
 *
 * The suite runs without a database, so the assertions are on the specs the
 * route hands the service — which is the seam where the provenance is either
 * carried or dropped. Turning a spec into a row with `assetKitId` and
 * `sourceKitId` set is `addScannedAssetsToBooking`'s own contract.
 *
 * @see {@link file://./bookings.add-scanned-assets.ts} route under test
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
// booking read, `assetKit.findMany` is what resolves a kit into its
// memberships, and `asset.findMany` backs the org guard on the scanned ids.
vi.mock("~/database/db.server", () => ({
  db: {
    booking: { findFirst: vi.fn() },
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
const assetKitFindManyMock = vi.mocked(db.assetKit.findMany);
const assetFindManyMock = vi.mocked(db.asset.findMany);
const addScannedAssetsToBookingMock = vi.mocked(addScannedAssetsToBooking);

const BOOKING_ID = "booking-1";

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
});

/** A DRAFT booking already holding the given kit memberships. */
function bookingHolding(assetKitIds: (string | null)[]) {
  findFirstMock.mockResolvedValue({
    id: BOOKING_ID,
    status: "DRAFT",
    from: new Date("2026-01-01T00:00:00.000Z"),
    to: new Date("2026-01-02T00:00:00.000Z"),
    custodianUserId: "user-1",
    bookingAssets: assetKitIds.map((assetKitId) => ({ assetKitId })),
  } as never);
}

/** The scanned assets exist in this org, so the org guard passes. */
function assetsExist(ids: string[]) {
  assetFindManyMock.mockResolvedValue(ids.map((id) => ({ id })) as never);
}

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

describe("POST /api/mobile/bookings/add-scanned-assets — kit provenance", () => {
  it("adds a scanned kit's members as kit-driven slices, not loose assets", async () => {
    bookingHolding([]);
    assetsExist([]);
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
    bookingHolding([]);
    assetsExist([]);
    assetKitFindManyMock.mockResolvedValue([] as never);

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
    bookingHolding([]);
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
    bookingHolding([]);
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

  it("adds only the members a partly-present kit is still missing", async () => {
    // Re-adding a kit the booking already holds part of must top it up, not
    // collide with the rows already there.
    bookingHolding(["ak1", null]);
    assetsExist([]);
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
