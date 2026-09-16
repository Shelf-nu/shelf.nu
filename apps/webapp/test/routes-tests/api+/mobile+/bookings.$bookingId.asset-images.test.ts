/**
 * Response-contract test for the photos the mobile booking detail endpoint
 * sends with each asset row.
 *
 * An asset's `mainImage` is a signed storage URL that stops loading once
 * `mainImageExpiration` passes, and the companion has no repair flow: it draws a
 * lapsed URL as an empty tile. So the loader hands its rows to
 * `refreshExpiredMobileAssetImages` before it answers. What the app depends on:
 *
 * 1. The row it renders carries the URL the repair returned, not the stored one.
 * 2. The repair is scoped to the caller's workspace.
 * 3. The repair runs once per asset, even when the booking holds several slices
 *    of the same quantity-tracked asset.
 * 4. The expiry that steers the repair is not sent, so the row keeps its shape.
 *
 * @see {@link file://./../../../../app/routes/api+/mobile+/bookings.$bookingId.ts}
 */

import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLoaderArgs } from "@mocks/remix";

import { db } from "~/database/db.server";
import { refreshExpiredMobileAssetImages } from "~/modules/api/mobile-asset-images.server";
import type * as MobileAuthServer from "~/modules/api/mobile-auth.server";
import {
  requireMobileAuth,
  requireOrganizationAccess,
  getMobileUserContext,
} from "~/modules/api/mobile-auth.server";

import { loader } from "~/routes/api+/mobile+/bookings.$bookingId";

import { assertIsDataWithResponseInit } from "@helpers/assertions";
import { mobileUserContext } from "@helpers/mobile-user-context";

// @vitest-environment node

// why: db is the integration boundary — the loader reads the booking through
// `booking.findFirst`. The lifecycle-progress roll-up's two reads are orthogonal
// to the photos under test, so they stub to empty.
vi.mock("~/database/db.server", () => ({
  db: {
    booking: { findFirst: vi.fn() },
    bookingAsset: { findMany: vi.fn().mockResolvedValue([]) },
    partialBookingCheckout: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

// why: JWT validation and org-membership resolution are out of scope; the
// remaining exports stay real so the response shaping runs as in production.
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

// why: booking settings and permission checks feed the action flags, a
// different contract from the photos under test — stub them to fixed values.
vi.mock("~/modules/booking-settings/service.server", () => ({
  getBookingSettingsForOrganization: vi.fn().mockResolvedValue({
    requireExplicitCheckinForAdmin: false,
    requireExplicitCheckinForSelfService: false,
  }),
}));
vi.mock("~/utils/permissions/permission.validator.server", () => ({
  hasPermission: vi.fn().mockResolvedValue(false),
}));

// why: the repair signs URLs against Supabase Storage and writes them back. It
// has its own unit test; here it answers with a known fresh URL so the test can
// see whether the loader serves what the repair returned.
vi.mock("~/modules/api/mobile-asset-images.server", () => ({
  refreshExpiredMobileAssetImages: vi.fn(
    (assets: Array<{ id: string; mainImage: string | null }>) =>
      Promise.resolve(
        assets.map((asset) => ({
          ...asset,
          mainImage: `https://storage.test/sign/assets/${asset.id}.png?token=new`,
        }))
      )
  ),
}));

const findFirstMock = vi.mocked(db.booking.findFirst);
const refreshMock = vi.mocked(refreshExpiredMobileAssetImages);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireMobileAuth).mockResolvedValue({
    user: { id: "user-1" },
  } as Awaited<ReturnType<typeof requireMobileAuth>>);
  vi.mocked(requireOrganizationAccess).mockResolvedValue("org-1");
  vi.mocked(getMobileUserContext).mockResolvedValue(
    mobileUserContext({ roles: [OrganizationRoles.ADMIN] })
  );
});

/** One BookingAsset slice of `assetId`, carrying a photo that has lapsed. */
function slice(id: string, assetId: string) {
  return {
    id,
    quantity: 1,
    assetKitId: null,
    asset: {
      id: assetId,
      title: `Asset ${assetId}`,
      type: "INDIVIDUAL",
      status: "AVAILABLE",
      mainImage: `https://storage.test/sign/assets/${assetId}.png?token=old`,
      thumbnailImage: null,
      mainImageExpiration: new Date("2020-01-01T00:00:00.000Z"),
      assetModel: null,
      category: null,
      assetKits: [],
      assetLocations: [],
    },
  };
}

/** A DRAFT booking holding the given slices, with everything else inert. */
function bookingRow(bookingAssets: ReturnType<typeof slice>[]) {
  return {
    id: "booking-1",
    name: "Stage build",
    description: null,
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

async function get() {
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
    booking: { assets: Array<{ id: string; mainImage: string | null }> };
  };
}

describe("GET /api/mobile/bookings/:bookingId — asset photos", () => {
  it("serves the re-signed URL, not the lapsed one it stored", async () => {
    findFirstMock.mockResolvedValue(bookingRow([slice("ba-1", "asset-1")]));

    const { booking } = await get();

    expect(booking.assets).toHaveLength(1);
    expect(booking.assets[0].mainImage).toBe(
      "https://storage.test/sign/assets/asset-1.png?token=new"
    );
    // The expiry only steers the repair; the row keeps the shape the app reads.
    expect(booking.assets[0]).not.toHaveProperty("mainImageExpiration");
  });

  it("repairs each asset once, scoped to the caller's workspace", async () => {
    // Two slices of the same asset collapse to one row before the repair.
    findFirstMock.mockResolvedValue(
      bookingRow([
        slice("ba-1", "asset-1"),
        slice("ba-2", "asset-1"),
        slice("ba-3", "asset-2"),
      ])
    );

    await get();

    expect(refreshMock).toHaveBeenCalledTimes(1);
    const [rows, organizationId] = refreshMock.mock.calls[0];
    expect(organizationId).toBe("org-1");
    expect(rows.map((row) => row.id)).toEqual(["asset-1", "asset-2"]);
  });
});
