/**
 * Contract tests for the mobile booking asset picker's quantity fields.
 *
 * The companion reads `type`, `quantity`, `unitOfMeasure`, `availableQuantity`
 * and `bookedQuantity` off every row to cap and prefill its quantity sheet.
 * These tests pin that shape, that availability is measured over the requested
 * window with the named booking excluded, that a fully reserved row stays on
 * the page (paging counts describe the rows returned), and that a booking the
 * caller may not see is never excluded or reported on.
 *
 * @see {@link file://../../../../app/routes/api+/mobile+/bookings.available-assets.ts} route under test
 */

import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLoaderArgs } from "@mocks/remix";

import { db } from "~/database/db.server";
import type * as MobileAuthServer from "~/modules/api/mobile-auth.server";
import {
  getMobileUserContext,
  requireMobileAuth,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { getAssetAvailabilityBatch } from "~/modules/asset/availability.server";
import { getPaginatedAndFilterableAssets } from "~/modules/asset/service.server";

import { loader } from "~/routes/api+/mobile+/bookings.available-assets";

import { assertIsDataWithResponseInit } from "@helpers/assertions";
import { mobileUserContext } from "@helpers/mobile-user-context";

// @vitest-environment node

// why: db is the integration boundary. The route reads the org's code
// preference, each row's codes and quantity fields, the named booking's
// custody links, and what that booking already holds.
vi.mock("~/database/db.server", () => ({
  db: {
    organization: { findUniqueOrThrow: vi.fn() },
    asset: { findMany: vi.fn() },
    booking: { findFirst: vi.fn() },
    bookingAsset: { findMany: vi.fn() },
  },
}));

// why: auth and entitlement are out of scope; keep `getMobileUserContext` a
// spy so a test can pick the caller's role. The real module is otherwise kept.
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

// why: which assets are bookable is the shared list service's job (own
// suites); here it returns a fixed page so the route's shaping is the subject.
vi.mock("~/modules/asset/service.server", () => ({
  ASSET_IMAGE_RESIGN_LIMITS: {},
  getPaginatedAndFilterableAssets: vi.fn(),
  refreshExpiredAssetImages: vi.fn(async (assets: unknown) => assets),
}));

// why: the availability math has its own suite; we assert what the route asks.
vi.mock("~/modules/asset/availability.server", () => ({
  getAssetAvailabilityBatch: vi.fn(),
}));

const listMock = vi.mocked(getPaginatedAndFilterableAssets);
const availabilityMock = vi.mocked(getAssetAvailabilityBatch);
const bookingFindFirstMock = vi.mocked(db.booking.findFirst);
const bookingAssetFindManyMock = vi.mocked(db.bookingAsset.findMany);

const CALLER_ID = "user-self";
const BOOKING_ID = "booking-1";
const FROM = "2026-09-10T09:00:00.000Z";
const TO = "2026-09-12T17:00:00.000Z";

/** A page row as the list service returns it. */
function listed(id: string) {
  return {
    id,
    title: `Asset ${id}`,
    status: "AVAILABLE",
    mainImage: null,
    thumbnailImage: null,
    mainImageExpiration: null,
    assetModel: null,
    assetKits: [],
  };
}

/** The narrow per-row lookup: codes plus quantity fields. */
function details(
  id: string,
  type: "INDIVIDUAL" | "QUANTITY_TRACKED",
  quantity: number | null = null
) {
  return {
    id,
    sequentialId: null,
    preferredBarcodeId: null,
    qrCodes: [{ id: `qr-${id}` }],
    barcodes: [],
    type,
    quantity,
    unitOfMeasure: type === "QUANTITY_TRACKED" ? "pcs" : null,
  };
}

/** GET with the picker's usual params, plus any overrides. */
function get(extra: Record<string, string> = {}) {
  const url = new URL(
    "http://localhost:3000/api/mobile/bookings/available-assets"
  );
  for (const [key, value] of Object.entries({
    orgId: "org-1",
    bookingFrom: FROM,
    bookingTo: TO,
    hideUnavailable: "true",
    unhideAssetsBookigIds: BOOKING_ID,
    ...extra,
  })) {
    url.searchParams.set(key, value);
  }
  return loader(createLoaderArgs({ request: new Request(url) }));
}

/** The response rows, typed as the companion reads them. */
async function rows(extra?: Record<string, string>) {
  const response = await get(extra);
  assertIsDataWithResponseInit(response);
  return response.data as {
    assets: Array<Record<string, unknown>>;
    totalCount: number;
    totalPages: number;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireMobileAuth).mockResolvedValue({
    user: { id: CALLER_ID },
  } as Awaited<ReturnType<typeof requireMobileAuth>>);
  vi.mocked(requireOrganizationAccess).mockResolvedValue("org-1");
  vi.mocked(getMobileUserContext).mockResolvedValue(
    mobileUserContext({ roles: [OrganizationRoles.ADMIN] })
  );
  vi.mocked(db.organization.findUniqueOrThrow).mockResolvedValue({
    qrIdDisplayPreference: "QR_ID",
    barcodesEnabled: false,
  } as never);

  listMock.mockResolvedValue({
    assets: [listed("ind"), listed("qt-free"), listed("qt-full")],
    page: 1,
    perPage: 100,
    totalAssets: 3,
    totalPages: 1,
  } as never);
  vi.mocked(db.asset.findMany).mockResolvedValue([
    details("ind", "INDIVIDUAL"),
    details("qt-free", "QUANTITY_TRACKED", 20),
    details("qt-full", "QUANTITY_TRACKED", 5),
  ] as never);
  availabilityMock.mockResolvedValue(
    new Map([
      ["qt-free", { total: 20, bookable: 7, reserved: 13, inCustody: 0 }],
      ["qt-full", { total: 5, bookable: 0, reserved: 5, inCustody: 0 }],
    ]) as never
  );
  bookingFindFirstMock.mockResolvedValue({
    id: BOOKING_ID,
    custodianUserId: "someone-else",
    custodianTeamMember: { userId: "someone-else" },
  } as never);
  bookingAssetFindManyMock.mockResolvedValue([
    { assetId: "qt-free", quantity: 3 },
  ] as never);
});

describe("GET /api/mobile/bookings/available-assets: quantity fields", () => {
  it("ships the quantity fields on quantity-tracked rows and nulls on individual ones", async () => {
    const { assets } = await rows();
    const byId = Object.fromEntries(assets.map((a) => [a.id, a]));

    expect(byId["qt-free"]).toMatchObject({
      type: "QUANTITY_TRACKED",
      quantity: 20,
      unitOfMeasure: "pcs",
      availableQuantity: 7,
      bookedQuantity: 3,
    });
    expect(byId.ind).toMatchObject({
      type: "INDIVIDUAL",
      quantity: null,
      unitOfMeasure: null,
      availableQuantity: null,
      bookedQuantity: null,
    });
  });

  it("measures availability over the requested window with the named booking excluded", async () => {
    await rows();

    expect(availabilityMock).toHaveBeenCalledWith(["qt-free", "qt-full"], {
      organizationId: "org-1",
      window: { from: new Date(FROM), to: new Date(TO) },
      excludeBookingId: BOOKING_ID,
    });
    expect(bookingAssetFindManyMock).toHaveBeenCalledWith({
      where: {
        bookingId: BOOKING_ID,
        assetKitId: null,
        assetId: { in: ["qt-free", "qt-full"] },
        booking: { organizationId: "org-1" },
      },
      select: { assetId: true, quantity: true },
    });
  });

  it("keeps a fully reserved row on the page, so paging counts match the rows", async () => {
    const { assets, totalCount, totalPages } = await rows();

    expect(assets.map((a) => a.id)).toEqual(["ind", "qt-free", "qt-full"]);
    expect(assets.find((a) => a.id === "qt-full")).toMatchObject({
      availableQuantity: 0,
    });
    expect(totalCount).toBe(3);
    expect(totalPages).toBe(1);
  });
});

describe("GET /api/mobile/bookings/available-assets: the named booking", () => {
  it("ignores a booking the caller may not see", async () => {
    vi.mocked(getMobileUserContext).mockResolvedValue(
      mobileUserContext({ roles: [OrganizationRoles.SELF_SERVICE] })
    );

    const { assets } = await rows();

    expect(availabilityMock).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ excludeBookingId: undefined })
    );
    expect(bookingAssetFindManyMock).not.toHaveBeenCalled();
    expect(assets.find((a) => a.id === "qt-free")).toMatchObject({
      bookedQuantity: null,
    });
  });

  it("uses a booking a restricted caller holds", async () => {
    vi.mocked(getMobileUserContext).mockResolvedValue(
      mobileUserContext({ roles: [OrganizationRoles.SELF_SERVICE] })
    );
    bookingFindFirstMock.mockResolvedValue({
      id: BOOKING_ID,
      custodianUserId: CALLER_ID,
      custodianTeamMember: { userId: CALLER_ID },
    } as never);

    await rows();

    expect(availabilityMock).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ excludeBookingId: BOOKING_ID })
    );
  });

  it("ignores a booking id from another workspace", async () => {
    bookingFindFirstMock.mockResolvedValue(null);

    await rows({ unhideAssetsBookigIds: "booking-elsewhere" });

    expect(bookingFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "booking-elsewhere", organizationId: "org-1" },
      })
    );
    expect(availabilityMock).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ excludeBookingId: undefined })
    );
  });

  it("names no booking when the picker sends none", async () => {
    const { assets } = await rows({ unhideAssetsBookigIds: "" });

    expect(assets).toHaveLength(3);
    expect(bookingFindFirstMock).not.toHaveBeenCalled();
    expect(bookingAssetFindManyMock).not.toHaveBeenCalled();
  });
});
