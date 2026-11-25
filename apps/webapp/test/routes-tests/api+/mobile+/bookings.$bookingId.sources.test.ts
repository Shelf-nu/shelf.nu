/**
 * Producer contract for `slices[].sources` and `slices[].sourceAllocation` on
 * the mobile booking detail endpoint:
 *
 * 1. A standalone pool slice planned by source (`AUTO` or `MANUAL`) carries
 *    its source parts, the same parts the web booking page's Location cell
 *    shows. Kit slices, individual assets and `LEGACY` slices carry none.
 * 2. A booking with no slice planned by source reads no summaries at all.
 * 3. The fields are additive: every field older apps read is still sent.
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
import type * as BookingSourcesServer from "~/modules/booking/sources/booking-sources.server";
import { getSliceSourceSummaries } from "~/modules/booking/sources/booking-sources.server";

import { loader } from "~/routes/api+/mobile+/bookings.$bookingId";

import { assertIsDataWithResponseInit } from "@helpers/assertions";
import { mobileUserContext } from "@helpers/mobile-user-context";

// @vitest-environment node

// why: db is the integration boundary. The booking row and every read the
// loader makes are fixtures; the ones this suite varies are the pools'
// slices' source modes and the pools' manual placements.
vi.mock("~/database/db.server", () => ({
  db: {
    booking: { findFirst: vi.fn() },
    // why: the lifecycle-progress roll-up reads the slice markers
    // (BookingAsset.checkedOutAt/checkedInAt) plus the checkout sessions to
    // judge dispatched units per asset, and the asset order counts the
    // sessions and the quantity-tracked assets' disposition logs per slice;
    // stub all three to empty - not what this suite checks
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
    custody: { findMany: vi.fn().mockResolvedValue([]) },
    location: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

// why: mobile-auth is the request-auth boundary - it resolves the actor and
// org from a Supabase JWT. Stub requireMobileAuth/requireOrganizationAccess/
// assertMobileCanUseBookings/getMobileUserContext so the test drives a
// deterministic authenticated user + org without real JWT verification;
// not what this suite checks serialization contract under test.
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
// above) - stub them to fixed values since per-asset remaining is unrelated
// to the pool sources contract under test. `bookingDraftVisibilityClause`
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
// pool source fields under test - stub them to fixed values.
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

// why: the summaries read capacity, competing holds and source rows across
// several tables; the facade has its own suite. Here only what the route does
// with the parts matters. The rest of the module stays real for the check-out
// question loader.
vi.mock("~/modules/booking/sources/booking-sources.server", async () => {
  const actual = await vi.importActual<typeof BookingSourcesServer>(
    "~/modules/booking/sources/booking-sources.server"
  );
  return { ...actual, getSliceSourceSummaries: vi.fn() };
});

const requireMobileAuthMock = vi.mocked(requireMobileAuth);
const requireOrganizationAccessMock = vi.mocked(requireOrganizationAccess);
const getMobileUserContextMock = vi.mocked(getMobileUserContext);

beforeEach(() => {
  vi.clearAllMocks();
  // `clearAllMocks` keeps implementations, so put back the empty default a
  // case may have replaced.
  vi.mocked(db.bookingAsset.findMany).mockResolvedValue([] as never);
  vi.mocked(db.assetLocation.findMany).mockResolvedValue([] as never);
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

/** Parts as the source facade builds them. */
const PARTS = [
  {
    key: "LOCATION:loc-a",
    kind: "LOCATION" as const,
    locationId: "loc-a",
    label: "Demo Warehouse",
    planned: 8,
    out: 0,
    short: false,
  },
  {
    key: "UNPLACED:",
    kind: "UNPLACED" as const,
    locationId: null,
    label: "Unplaced",
    planned: 7,
    out: 0,
    short: false,
  },
];

const KIT_POOL = {
  ...POOL,
  assetKits: [{ id: "ak-1", kit: { id: "kit-1", name: "Event kit" } }],
};

type SliceBody = {
  bookingAssetId: string;
  quantity: number;
  kit: { id: string; name: string } | null;
  sourceLocation: { id: string; name: string } | null;
  sources: typeof PARTS;
  sourceAllocation: string;
};

async function getSlices() {
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
    booking: { assets: Array<{ id: string; slices: SliceBody[] }> };
  };
  const slices = body.booking.assets.flatMap((asset) => asset.slices);
  return (id: string) => slices.find((s) => s.bookingAssetId === id);
}

describe("GET /api/mobile/bookings/:bookingId pool sources", () => {
  it("sends the source parts of a pool slice planned by source, and none for kit slices or individual assets", async () => {
    vi.mocked(db.booking.findFirst).mockResolvedValue(
      bookingRow("RESERVED", [
        {
          id: "ba-pool",
          quantity: 15,
          assetKitId: null,
          sourceKitId: null,
          sourceLocationId: null,
          sourceAllocation: "MANUAL",
          asset: KIT_POOL,
        },
        {
          id: "ba-kit",
          quantity: 3,
          assetKitId: "ak-1",
          sourceKitId: "kit-1",
          sourceLocationId: null,
          sourceAllocation: "KIT",
          asset: KIT_POOL,
        },
        {
          id: "ba-cam",
          quantity: 1,
          assetKitId: null,
          sourceKitId: null,
          sourceLocationId: null,
          sourceAllocation: "LEGACY",
          asset: CAMERA,
        },
      ]) as never
    );
    // why: the pool has a manual placement, so its sources say more than
    // "Unplaced".
    vi.mocked(db.assetLocation.findMany).mockResolvedValue([
      { assetId: "pool-1" },
    ] as never);
    // why: the summaries per slice, as the facade returns them.
    vi.mocked(getSliceSourceSummaries).mockResolvedValue(
      new Map([
        ["ba-pool", { parts: PARTS, short: false, mode: "MANUAL" as const }],
        ["ba-kit", { parts: [], short: false, mode: "KIT" as const }],
        ["ba-cam", { parts: [], short: false, mode: "LEGACY" as const }],
      ])
    );

    const slice = await getSlices();

    expect(getSliceSourceSummaries).toHaveBeenCalledWith({
      organizationId: "org-1",
      bookingId: "booking-1",
    });
    expect(slice("ba-pool")?.sources).toEqual(PARTS);
    expect(slice("ba-pool")?.sourceAllocation).toBe("MANUAL");
    expect(slice("ba-kit")?.sources).toEqual([]);
    expect(slice("ba-cam")?.sources).toEqual([]);
    // The manual placement read is org-scoped and skips kit placements.
    expect(db.assetLocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          assetId: { in: ["pool-1"] },
          organizationId: "org-1",
          assetKitId: null,
        },
      })
    );
  });

  it("keeps every field older apps read next to the new ones", async () => {
    vi.mocked(db.booking.findFirst).mockResolvedValue(
      bookingRow("RESERVED", [
        {
          id: "ba-pool",
          quantity: 15,
          assetKitId: null,
          sourceKitId: null,
          sourceLocationId: null,
          sourceAllocation: "AUTO",
          asset: POOL,
        },
      ]) as never
    );
    vi.mocked(db.assetLocation.findMany).mockResolvedValue([
      { assetId: "pool-1" },
    ] as never);
    vi.mocked(getSliceSourceSummaries).mockResolvedValue(
      new Map([
        ["ba-pool", { parts: PARTS, short: false, mode: "AUTO" as const }],
      ])
    );

    const slice = await getSlices();

    expect(slice("ba-pool")).toEqual({
      bookingAssetId: "ba-pool",
      quantity: 15,
      assetKitId: null,
      kit: null,
      sourceLocation: null,
      sources: PARTS,
      sourceAllocation: "AUTO",
    });
  });

  it("sends no parts for a pool with no manual placement whose units are all unplaced", async () => {
    vi.mocked(db.booking.findFirst).mockResolvedValue(
      bookingRow("RESERVED", [
        {
          id: "ba-pool",
          quantity: 7,
          assetKitId: null,
          sourceKitId: null,
          sourceLocationId: null,
          sourceAllocation: "AUTO",
          asset: POOL,
        },
      ]) as never
    );
    vi.mocked(getSliceSourceSummaries).mockResolvedValue(
      new Map([
        ["ba-pool", { parts: [PARTS[1]], short: false, mode: "AUTO" as const }],
      ])
    );

    const slice = await getSlices();

    expect(slice("ba-pool")?.sources).toEqual([]);
  });

  it("reads no summaries for a booking whose pool slices are not planned by source", async () => {
    vi.mocked(db.booking.findFirst).mockResolvedValue(
      bookingRow("RESERVED", [
        {
          id: "ba-pool",
          quantity: 15,
          assetKitId: null,
          sourceKitId: null,
          sourceLocationId: null,
          sourceAllocation: "LEGACY",
          asset: POOL,
        },
      ]) as never
    );

    const slice = await getSlices();

    expect(getSliceSourceSummaries).not.toHaveBeenCalled();
    expect(slice("ba-pool")?.sources).toEqual([]);
    expect(slice("ba-pool")?.sourceAllocation).toBe("LEGACY");
  });
});
