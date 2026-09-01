/**
 * Response-contract test for the mobile booking detail endpoint's per-slice
 * breakdown (Companion QT display parity, Gap 1). The loader collapses every
 * `BookingAsset` row for a quantity-tracked asset into one merged row (summed
 * quantity), which loses which slice is standalone vs. kit-driven and — worse
 * — mislabels the merged row's `kit` from the asset's FIRST kit membership
 * regardless of which slice(s) it actually came from. This test pins:
 *
 * 1. The new additive `slices[]` array: one entry per BookingAsset row, each
 *    carrying its own `bookingAssetId` / `quantity` / `assetKitId` / `kit`.
 * 2. The merged-kit fix: `kit`/`kitId` reflect the UNANIMOUS membership across
 *    all of an asset's slices, or `null` for standalone/mixed — replacing the
 *    old `assetKits[0].kit` synthesis that mislabelled non-unanimous rows.
 * 3. A regression control: an asset unanimously in ONE kit must still surface
 *    that kit as its merged `kit` (kit-driven rows stay labelled).
 *
 * @see {@link file://./bookings.$bookingId.ts} loader under test
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

// @vitest-environment node

// why: db is the integration boundary — the loader reads the booking (with
// its BookingAsset slices) via `booking.findFirst` and the lifecycle-progress
// roll-up via `partialBookingCheckout.findMany`. Stub the latter to an empty
// log (irrelevant to the slices/kit-label contract under test).
vi.mock("~/database/db.server", () => ({
  db: {
    booking: { findFirst: vi.fn() },
    // why: the lifecycle-progress roll-up reads the slice markers
    // (BookingAsset.checkedOutAt/checkedInAt) plus the checkout sessions to
    // judge dispatched units per asset; stub both to empty — orthogonal to
    // the slices/merged-kit serialization contract under test.
    bookingAsset: { findMany: vi.fn().mockResolvedValue([]) },
    partialBookingCheckout: { findMany: vi.fn().mockResolvedValue([]) },
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
    getPartiallyCheckedInAssetIds: vi.fn().mockResolvedValue([]),
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
  getMobileUserContextMock.mockResolvedValue({
    role: OrganizationRoles.ADMIN,
    roles: [OrganizationRoles.ADMIN],
    canUseBarcodes: true,
    canUseAudits: true,
    canSeeAllCustody: true,
  });
});

const K1 = { id: "kit-1", name: "Kit One" };
const K2 = { id: "kit-2", name: "Kit Two" };
const K3 = { id: "kit-3", name: "Kit Three" };

describe("GET /api/mobile/bookings/:bookingId — per-slice breakdown + merged kit", () => {
  it("exposes slices[] and fixes the merged kit for standalone/kit-driven/mixed assets", async () => {
    findFirstMock.mockResolvedValue({
      id: "booking-1",
      name: "Shoot",
      description: null,
      status: "DRAFT", // DRAFT → skips getPartiallyCheckedInAssetIds
      from: null,
      to: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      creator: null,
      custodianUser: null,
      custodianTeamMember: null,
      tags: [],
      bookingAssets: [
        // Asset A: mixed — standalone (4) + kit K1 (3) + kit K2 (3) = 10.
        {
          id: "ba0",
          quantity: 4,
          assetKitId: null,
          asset: {
            id: "asset-a",
            title: "Cable A",
            status: "AVAILABLE",
            type: "QUANTITY_TRACKED",
            unitOfMeasure: "meters",
            consumptionType: "RETURN",
            mainImage: null,
            category: null,
            assetKits: [
              { id: "ak1", kit: K1 },
              { id: "ak2", kit: K2 },
            ],
          },
        },
        {
          id: "ba1",
          quantity: 3,
          assetKitId: "ak1",
          asset: {
            id: "asset-a",
            title: "Cable A",
            status: "AVAILABLE",
            type: "QUANTITY_TRACKED",
            unitOfMeasure: "meters",
            consumptionType: "RETURN",
            mainImage: null,
            category: null,
            assetKits: [
              { id: "ak1", kit: K1 },
              { id: "ak2", kit: K2 },
            ],
          },
        },
        {
          id: "ba2",
          quantity: 3,
          assetKitId: "ak2",
          asset: {
            id: "asset-a",
            title: "Cable A",
            status: "AVAILABLE",
            type: "QUANTITY_TRACKED",
            unitOfMeasure: "meters",
            consumptionType: "RETURN",
            mainImage: null,
            category: null,
            assetKits: [
              { id: "ak1", kit: K1 },
              { id: "ak2", kit: K2 },
            ],
          },
        },
        // Asset B: control — single standalone slice, no kit memberships.
        {
          id: "bb0",
          quantity: 2,
          assetKitId: null,
          asset: {
            id: "asset-b",
            title: "Tripod B",
            status: "AVAILABLE",
            type: "QUANTITY_TRACKED",
            unitOfMeasure: "units",
            consumptionType: "RETURN",
            mainImage: null,
            category: null,
            assetKits: [],
          },
        },
        // Asset C: control — unanimously in ONE kit (K3). Regression guard:
        // the merged kit must still resolve to K3, not null.
        {
          id: "cc0",
          quantity: 5,
          assetKitId: "ak3",
          asset: {
            id: "asset-c",
            title: "Light C",
            status: "AVAILABLE",
            type: "QUANTITY_TRACKED",
            unitOfMeasure: "units",
            consumptionType: "RETURN",
            mainImage: null,
            category: null,
            assetKits: [{ id: "ak3", kit: K3 }],
          },
        },
      ],
      modelRequests: [],
      _count: { bookingAssets: 5 },
    } as never);

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
      booking: {
        assets: Array<{
          id: string;
          quantity: number;
          assetKitId: string | null;
          kit: { id: string; name: string } | null;
          kitId: string | null;
          slices: Array<{
            bookingAssetId: string;
            quantity: number;
            assetKitId: string | null;
            kit: { id: string; name: string } | null;
          }>;
        }>;
      };
    };

    const byId = new Map(body.booking.assets.map((a) => [a.id, a]));

    // Asset A: mixed standalone + 2 kits → summed quantity, null merged kit,
    // 3 slices each carrying its own kit resolution.
    const assetA = byId.get("asset-a");
    expect(assetA).toBeDefined();
    expect(assetA?.quantity).toBe(10);
    expect(assetA?.assetKitId).toBeNull();
    expect(assetA?.kit).toBeNull();
    expect(assetA?.kitId).toBeNull();
    expect(assetA?.slices).toHaveLength(3);
    expect(assetA?.slices).toEqual([
      { bookingAssetId: "ba0", quantity: 4, assetKitId: null, kit: null },
      { bookingAssetId: "ba1", quantity: 3, assetKitId: "ak1", kit: K1 },
      { bookingAssetId: "ba2", quantity: 3, assetKitId: "ak2", kit: K2 },
    ]);

    // Asset B: single standalone slice → 1 slice, null kit throughout.
    const assetB = byId.get("asset-b");
    expect(assetB).toBeDefined();
    expect(assetB?.quantity).toBe(2);
    expect(assetB?.kit).toBeNull();
    expect(assetB?.slices).toHaveLength(1);
    expect(assetB?.slices).toEqual([
      { bookingAssetId: "bb0", quantity: 2, assetKitId: null, kit: null },
    ]);

    // Asset C: unanimous single kit → merged kit MUST still be K3 (this is
    // the regression control for the merged-kit fix).
    const assetC = byId.get("asset-c");
    expect(assetC).toBeDefined();
    expect(assetC?.quantity).toBe(5);
    expect(assetC?.assetKitId).toBe("ak3");
    expect(assetC?.kit).toEqual(K3);
    expect(assetC?.kitId).toBe(K3.id);
    expect(assetC?.slices).toHaveLength(1);
    expect(assetC?.slices).toEqual([
      { bookingAssetId: "cc0", quantity: 5, assetKitId: "ak3", kit: K3 },
    ]);
  });
});
