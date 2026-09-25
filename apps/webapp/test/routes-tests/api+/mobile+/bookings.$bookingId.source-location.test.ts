/**
 * Response contract for the source-location fields on the mobile booking
 * detail endpoint:
 *
 * 1. Each quantity-tracked slice carries `sourceLocation { id, name }`, the
 *    location its units left from at check-out, resolved through an
 *    org-scoped lookup. Individual assets never carry one.
 * 2. `checkoutSourceQuestions` lists the pools that sit at two or more
 *    locations and have not gone out yet, with the location the server picks
 *    when nothing is sent, so the phone can ask the same question the web
 *    check-out dialogs ask.
 *
 * @see {@link file://../../../../app/routes/api+/mobile+/bookings.$bookingId.ts} loader under test
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

import { loader } from "~/routes/api+/mobile+/bookings.$bookingId";

import { assertIsDataWithResponseInit } from "@helpers/assertions";
import { mobileUserContext } from "@helpers/mobile-user-context";

// @vitest-environment node

// why: db is the integration boundary. The booking row and every read the
// loader makes are fixtures; the ones this suite varies are the pools'
// placements and the recorded source locations.
vi.mock("~/database/db.server", () => ({
  db: {
    booking: { findFirst: vi.fn() },
    // why: the lifecycle-progress roll-up reads the slice markers
    // (BookingAsset.checkedOutAt/checkedInAt) plus the checkout sessions to
    // judge dispatched units per asset, and the asset order counts the
    // sessions and the quantity-tracked assets' disposition logs per slice;
    // stub all three to empty — orthogonal to the slices/merged-kit
    // serialization contract under test.
    bookingAsset: { findMany: vi.fn().mockResolvedValue([]) },
    partialBookingCheckout: { findMany: vi.fn().mockResolvedValue([]) },
    consumptionLog: { findMany: vi.fn().mockResolvedValue([]) },
    // why: the fixture's kit-driven slices make the loader describe the kits
    // they belong to. What those kits look like is pinned by the sibling kits
    // test; here the payload only has to exist.
    kit: { findMany: vi.fn().mockResolvedValue([]) },
    // why: the check-out "From location" read and the source-name lookup.
    // Each case sets what its pools look like.
    asset: { findMany: vi.fn().mockResolvedValue([]) },
    assetLocation: { findMany: vi.fn().mockResolvedValue([]) },
    location: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

// why: mobile-auth is the request-auth boundary — it resolves the actor and
// org from a Supabase JWT. Stub requireMobileAuth/requireOrganizationAccess/
// assertMobileCanUseBookings/getMobileUserContext so the test drives a
// deterministic authenticated user + org without real JWT verification;
// orthogonal to the slices/merged-kit serialization contract under test.
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

// why: the QT-remaining helpers hit `tx.bookingAsset` / `tx.consumptionLog`
// directly (not through the mocked `db.booking`/`db.partialBookingCheckout`
// above) — stub them to fixed values since per-asset remaining is unrelated
// to the slices/merged-kit contract under test. `bookingDraftVisibilityClause`
// is kept real (pure where-clause builder, no db access) since it feeds the
// mocked `findFirst`'s arguments only.
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

// why: booking settings + permission checks are unrelated to the
// slices/merged-kit serialization under test — stub them to fixed values.
vi.mock("~/modules/booking-settings/service.server", () => ({
  getBookingSettingsForOrganization: vi.fn().mockResolvedValue({
    requireExplicitCheckinForAdmin: false,
    requireExplicitCheckinForSelfService: false,
    countKitsAsSingleUnit: false,
  }),
}));
vi.mock("~/utils/permissions/permission.validator.server", () => ({
  hasPermission: vi.fn().mockResolvedValue(false),
}));

const requireMobileAuthMock = vi.mocked(requireMobileAuth);
const requireOrganizationAccessMock = vi.mocked(requireOrganizationAccess);
const getMobileUserContextMock = vi.mocked(getMobileUserContext);

beforeEach(() => {
  vi.clearAllMocks();
  // `clearAllMocks` keeps implementations, so put back the empty default a
  // case may have replaced.
  vi.mocked(db.bookingAsset.findMany).mockResolvedValue([] as never);
  requireMobileAuthMock.mockResolvedValue({
    user: { id: "user-1" },
  } as Awaited<ReturnType<typeof requireMobileAuth>>);
  requireOrganizationAccessMock.mockResolvedValue("org-1");
  getMobileUserContextMock.mockResolvedValue(
    mobileUserContext({ roles: [OrganizationRoles.ADMIN] })
  );
});

const POOL = {
  id: "pool-1",
  title: "AA Batteries",
  status: "AVAILABLE",
  type: "QUANTITY_TRACKED",
  unitOfMeasure: "pcs",
  consumptionType: "ONE_WAY",
  mainImage: null,
  category: null,
  assetKits: [],
};
const CAMERA = {
  id: "cam-1",
  title: "Camera",
  status: "AVAILABLE",
  type: "INDIVIDUAL",
  unitOfMeasure: null,
  consumptionType: null,
  mainImage: null,
  category: null,
  assetKits: [],
};

/** A booking row as `booking.findFirst` returns it. */
function bookingRow(
  status: string,
  bookingAssets: Array<Record<string, unknown>>
) {
  return {
    id: "booking-1",
    name: "Shoot",
    description: null,
    status,
    from: new Date("2026-09-25T09:00:00.000Z"),
    to: new Date("2026-09-27T09:00:00.000Z"),
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    creator: null,
    custodianUser: null,
    custodianTeamMember: null,
    tags: [],
    bookingAssets,
    modelRequests: [],
    _count: { bookingAssets: bookingAssets.length },
  };
}

async function getBooking() {
  const response = await loader(
    createLoaderArgs({
      request: new Request(
        "http://localhost:3000/api/mobile/bookings/booking-1"
      ),
      params: { bookingId: "booking-1" },
    })
  );
  assertIsDataWithResponseInit(response);
  return response.data as {
    booking: {
      assets: Array<{
        id: string;
        slices: Array<{
          bookingAssetId: string;
          sourceLocation: { id: string; name: string } | null;
        }>;
      }>;
    };
    checkoutSourceQuestions: Array<{
      sliceId: string;
      defaultLocationId: string | null;
      placements: Array<{ locationId: string; placed: number }>;
    }>;
  };
}

describe("GET /api/mobile/bookings/:bookingId source locations", () => {
  it("names the location each pool slice left from, and never an individual asset's", async () => {
    vi.mocked(db.booking.findFirst).mockResolvedValue(
      bookingRow("ONGOING", [
        {
          id: "ba-pool",
          quantity: 10,
          assetKitId: null,
          sourceLocationId: "loc-studio",
          asset: POOL,
        },
        {
          id: "ba-cam",
          quantity: 1,
          assetKitId: null,
          sourceLocationId: "loc-studio",
          asset: CAMERA,
        },
      ]) as never
    );
    vi.mocked(db.location.findMany).mockResolvedValue([
      { id: "loc-studio", name: "Studio" },
    ] as never);

    const body = await getBooking();

    const slice = (id: string) =>
      body.booking.assets
        .flatMap((asset) => asset.slices)
        .find((s) => s.bookingAssetId === id);
    expect(slice("ba-pool")?.sourceLocation).toEqual({
      id: "loc-studio",
      name: "Studio",
    });
    expect(slice("ba-cam")?.sourceLocation).toBeNull();
    expect(db.location.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["loc-studio"] }, organizationId: "org-1" },
      })
    );
  });

  it("lists a pool at two locations that has not gone out, pre-picking the one with most units", async () => {
    vi.mocked(db.booking.findFirst).mockResolvedValue(
      bookingRow("RESERVED", [
        {
          id: "ba-pool",
          quantity: 10,
          assetKitId: null,
          sourceLocationId: null,
          asset: POOL,
        },
      ]) as never
    );
    // The questions read asks for slices still at 0 units out; every other
    // slice read in the loader gets nothing.
    vi.mocked(db.bookingAsset.findMany).mockImplementation(((args: {
      where?: { checkedOutQuantity?: number };
    }) =>
      Promise.resolve(
        args?.where?.checkedOutQuantity === 0
          ? [{ id: "ba-pool", assetId: "pool-1", quantity: 10 }]
          : []
      )) as never);
    vi.mocked(db.asset.findMany).mockResolvedValue([
      {
        id: "pool-1",
        title: "AA Batteries",
        quantity: 100,
        unitOfMeasure: "pcs",
      },
    ] as never);
    vi.mocked(db.assetLocation.findMany).mockResolvedValue([
      {
        assetId: "pool-1",
        locationId: "loc-studio",
        quantity: 40,
        location: { name: "Studio" },
      },
      {
        assetId: "pool-1",
        locationId: "loc-store",
        quantity: 60,
        location: { name: "Store Room" },
      },
    ] as never);

    const body = await getBooking();

    expect(body.checkoutSourceQuestions).toHaveLength(1);
    expect(body.checkoutSourceQuestions[0]).toMatchObject({
      sliceId: "ba-pool",
      defaultLocationId: "loc-store",
      placements: [
        { locationId: "loc-studio", placed: 40 },
        { locationId: "loc-store", placed: 60 },
      ],
    });
  });

  it("asks nothing on a booking that can no longer check out", async () => {
    vi.mocked(db.booking.findFirst).mockResolvedValue(
      bookingRow("COMPLETE", [
        {
          id: "ba-pool",
          quantity: 10,
          assetKitId: null,
          sourceLocationId: null,
          asset: POOL,
        },
      ]) as never
    );

    const body = await getBooking();

    expect(body.checkoutSourceQuestions).toEqual([]);
    expect(db.asset.findMany).not.toHaveBeenCalled();
  });
});
