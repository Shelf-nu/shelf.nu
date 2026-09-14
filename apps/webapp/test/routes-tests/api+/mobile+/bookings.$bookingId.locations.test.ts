/**
 * Response-contract test for the location the mobile booking detail endpoint
 * sends with each asset. The companion prints it under the asset's title, on
 * standalone rows and kit members alike, and searches it, so three things are
 * a contract the app depends on:
 *
 * 1. Each asset carries `location: { id, name }` — its primary placement on
 *    the `AssetLocation` pivot — or `location: null` when it is unplaced.
 * 2. The pivot itself never reaches the payload; `location` is the one field.
 * 3. The query asks for exactly one placement, in the shared placement order,
 *    with a tight select, so the primary location is the same on every refresh
 *    and the payload carries no placement data the app does not read.
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
import { ASSET_LOCATIONS_INCLUDE } from "~/modules/asset/fields";
import type * as BookingServiceServer from "~/modules/booking/service.server";

import { loader } from "~/routes/api+/mobile+/bookings.$bookingId";

import { assertIsDataWithResponseInit } from "@helpers/assertions";
import { mobileUserContext } from "@helpers/mobile-user-context";

// @vitest-environment node

// why: db is the integration boundary — the loader reads the booking, and the
// asset placements under test, through `booking.findFirst`. The kit lookup and
// the lifecycle-progress roll-up's two reads are orthogonal here, so they stub
// to empty.
vi.mock("~/database/db.server", () => ({
  db: {
    booking: { findFirst: vi.fn() },
    kit: { findMany: vi.fn().mockResolvedValue([]) },
    bookingAsset: { findMany: vi.fn().mockResolvedValue([]) },
    partialBookingCheckout: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

// why: JWT validation and org-membership resolution are out of scope; the
// remaining exports stay real so nothing else is silently replaced.
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
// directly rather than the delegates mocked above, and per-asset remaining is
// unrelated to the location under test.
vi.mock("~/modules/booking/service.server", async () => {
  const actual = await vi.importActual<typeof BookingServiceServer>(
    "~/modules/booking/service.server"
  );
  return {
    ...actual,
    computeBookingAssetRemaining: vi.fn().mockResolvedValue(0),
    computeBookingAssetRemainingToCheckOut: vi.fn().mockResolvedValue(0),
    getPartiallyCheckedInAssetIds: vi.fn().mockResolvedValue([]),
  };
});

// why: the loader reads workspace booking settings to decide the check-in and
// kit-counting flags. They do not reach the location under test, so fixed
// values keep the response deterministic.
vi.mock("~/modules/booking-settings/service.server", () => ({
  getBookingSettingsForOrganization: vi.fn().mockResolvedValue({
    requireExplicitCheckinForAdmin: false,
    requireExplicitCheckinForSelfService: false,
    countKitsAsSingleUnit: false,
  }),
}));

// why: the loader resolves six booking permissions to build its action flags.
// Those flags are a different contract from the location under test, and
// resolving them for real would need the permission tables — so answer a fixed
// `false` and let the tests assert on the asset rows alone.
vi.mock("~/utils/permissions/permission.validator.server", () => ({
  hasPermission: vi.fn().mockResolvedValue(false),
}));

const findFirstMock = vi.mocked(db.booking.findFirst);
const requireMobileAuthMock = vi.mocked(requireMobileAuth);
const requireOrganizationAccessMock = vi.mocked(requireOrganizationAccess);
const getMobileUserContextMock = vi.mocked(getMobileUserContext);

beforeEach(() => {
  vi.clearAllMocks();
  requireMobileAuthMock.mockResolvedValue({
    user: { id: "user-1" },
  } as Awaited<ReturnType<typeof requireMobileAuth>>);
  requireOrganizationAccessMock.mockResolvedValue("org-1");
  getMobileUserContextMock.mockResolvedValue(
    mobileUserContext({ roles: [OrganizationRoles.ADMIN] })
  );
});

const STORE = { id: "loc-store", name: "Main Store" };
const VAN = { id: "loc-van", name: "Van 2" };
const AUDIO = { id: "kit-audio", name: "Audio Package" };

/**
 * One BookingAsset row for an asset placed at `location` (or unplaced), booked
 * through `membership` or standalone.
 */
function slice({
  id,
  assetId,
  location,
  membership = null,
  kit = null,
}: {
  id: string;
  assetId: string;
  location: { id: string; name: string } | null;
  membership?: string | null;
  kit?: { id: string; name: string } | null;
}) {
  return {
    id,
    quantity: 1,
    assetKitId: membership,
    asset: {
      id: assetId,
      title: `Asset ${assetId}`,
      status: "AVAILABLE",
      type: "INDIVIDUAL",
      unitOfMeasure: null,
      consumptionType: null,
      mainImage: null,
      category: null,
      assetKits: membership && kit ? [{ id: membership, kit }] : [],
      // The pivot as the query projects it: at most one row, the primary.
      assetLocations: location ? [{ location }] : [],
    },
  };
}

/** A booking row carrying the given slices, with everything else inert. */
function bookingRow(bookingAssets: ReturnType<typeof slice>[]) {
  return {
    id: "booking-1",
    name: "Load-in",
    description: null,
    // DRAFT keeps `getPartiallyCheckedInAssetIds` out of the path.
    status: "DRAFT",
    from: null,
    to: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    creator: null,
    custodianUserId: null,
    custodianUser: null,
    custodianTeamMember: null,
    tags: [],
    bookingAssets,
    modelRequests: [],
    _count: { bookingAssets: bookingAssets.length },
  } as never;
}

/** Runs the loader for the fixture booking and returns its asset rows. */
async function assetsOf(bookingAssets: ReturnType<typeof slice>[]) {
  findFirstMock.mockResolvedValue(bookingRow(bookingAssets));
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
    booking: { assets: Array<Record<string, unknown> & { id: string }> };
  };
  return body.booking.assets;
}

describe("GET /api/mobile/bookings/:bookingId — where each asset sits", () => {
  it("sends a placed asset's primary location as { id, name }", async () => {
    const [asset] = await assetsOf([
      slice({ id: "ba1", assetId: "a1", location: STORE }),
    ]);

    expect(asset.location).toEqual({ id: "loc-store", name: "Main Store" });
  });

  it("sends null for an asset with no placement", async () => {
    const [asset] = await assetsOf([
      slice({ id: "ba1", assetId: "a1", location: null }),
    ]);

    // Present and null, not absent: the app tells "unplaced" apart from an
    // older server that sends no location at all.
    expect(asset).toHaveProperty("location", null);
  });

  it("sends a kit member's own location, as it does for standalone assets", async () => {
    const assets = await assetsOf([
      slice({ id: "ba1", assetId: "a1", location: STORE }),
      slice({
        id: "ba2",
        assetId: "a2",
        location: VAN,
        membership: "ak2",
        kit: AUDIO,
      }),
    ]);

    const member = assets.find((a) => a.id === "a2");
    expect(member).toMatchObject({
      kitId: "kit-audio",
      location: { id: "loc-van", name: "Van 2" },
    });
  });

  it("keeps the placement pivot out of the payload", async () => {
    const [asset] = await assetsOf([
      slice({ id: "ba1", assetId: "a1", location: STORE }),
    ]);

    expect(asset).not.toHaveProperty("assetLocations");
  });

  it("asks for one placement per asset, in the shared order, with a tight select", async () => {
    await assetsOf([slice({ id: "ba1", assetId: "a1", location: STORE })]);

    const query = findFirstMock.mock.calls[0]?.[0] as {
      select: {
        bookingAssets: {
          select: { asset: { select: Record<string, unknown> } };
        };
      };
    };
    expect(
      query.select.bookingAssets.select.asset.select.assetLocations
    ).toEqual({
      select: { location: { select: { id: true, name: true } } },
      orderBy: ASSET_LOCATIONS_INCLUDE.orderBy,
      take: 1,
    });
  });
});
