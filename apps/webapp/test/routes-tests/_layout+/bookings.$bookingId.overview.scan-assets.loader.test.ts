/**
 * Scan to Assign loader: `assignSession` derivation.
 *
 * Pins:
 *  - `assignSession` is null when the booking reserves no models, so the
 *    screen renders exactly as it did before this reservation context
 *    existed;
 *  - each outstanding model request reports `remaining` as `quantity`
 *    minus `fulfilledQuantity`, not the raw booked count;
 *  - a standalone `BookingAsset` row with no reservation stamp is
 *    claimable, and one that already answered a reservation is not.
 *
 * @see {@link file://./../../../app/routes/_layout+/bookings.$bookingId.overview.scan-assets.tsx}
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLoaderArgs } from "@mocks/remix";

// why: the loader's own logic under test is deriving `assignSession` from
// the booking; the permission gate and the booking fetch have their own
// suites, so both are stubbed here.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

// why: the route imports both `getBooking` (the loader) and
// `addScannedAssetsToBooking` (the action) from this module. A mock
// factory that supplies only one leaves the other `undefined`, and the
// route fails to load.
vi.mock("~/modules/booking/service.server", () => ({
  getBooking: vi.fn(),
  addScannedAssetsToBooking: vi.fn(),
}));

// why: the loader's supplementary `assetModelId` lookup hits this directly
// (see the route's JSDoc on `assignSession`); a database call has no place
// in a route-level test.
vi.mock("~/database/db.server", () => ({
  db: {
    asset: {
      findMany: vi.fn(),
    },
  },
}));

import { db } from "~/database/db.server";
import { getBooking } from "~/modules/booking/service.server";
import { requirePermission } from "~/utils/roles.server";
import { loader } from "~/routes/_layout+/bookings.$bookingId.overview.scan-assets";

// @vitest-environment node

/** Minimal booking shape the loader reads, with sane defaults per test. */
function bookingWith(overrides: Record<string, unknown>) {
  return {
    id: "booking-1",
    name: "Booking One",
    status: "RESERVED",
    from: new Date("2026-01-01T09:00:00Z"),
    to: new Date("2026-01-02T09:00:00Z"),
    custodianUserId: null,
    creatorId: "user-1",
    modelRequests: [],
    bookingAssets: [],
    ...overrides,
  };
}

const mockContext = {
  getSession: () => ({ userId: "user-1" }),
} as unknown as Parameters<typeof loader>[0]["context"];

const mockParams = { bookingId: "booking-1" };

async function runLoader() {
  return (await loader(
    createLoaderArgs({ context: mockContext, params: mockParams })
  )) as {
    assignSession: {
      expectedModelRequests: Array<{
        assetModelId: string;
        assetModelName: string;
        booked: number;
        remaining: number;
      }>;
      alreadyIncluded: Array<{ id: string; claimable: boolean }>;
    } | null;
  };
}

describe("scan-assets loader assignSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePermission).mockResolvedValue({
      organizationId: "org-1",
      role: "ADMIN",
      userOrganizations: [],
    } as unknown as Awaited<ReturnType<typeof requirePermission>>);
    vi.mocked(db.asset.findMany).mockResolvedValue([]);
  });

  it("is null when the booking reserves no models", async () => {
    vi.mocked(getBooking).mockResolvedValue(
      bookingWith({}) as unknown as Awaited<ReturnType<typeof getBooking>>
    );

    expect((await runLoader()).assignSession).toBeNull();
  });

  it("reports each outstanding model's remaining units", async () => {
    vi.mocked(getBooking).mockResolvedValue(
      bookingWith({
        modelRequests: [
          {
            id: "req-1",
            assetModelId: "model-1",
            quantity: 3,
            fulfilledQuantity: 1,
            fulfilledAt: null,
            assetModel: { id: "model-1", name: "Model One" },
          },
        ],
      }) as unknown as Awaited<ReturnType<typeof getBooking>>
    );

    const { assignSession } = await runLoader();
    expect(assignSession?.expectedModelRequests).toEqual([
      {
        assetModelId: "model-1",
        assetModelName: "Model One",
        booked: 3,
        remaining: 2,
      },
    ]);
  });

  it("marks an unstamped standalone row claimable and a stamped one not", async () => {
    vi.mocked(getBooking).mockResolvedValue(
      bookingWith({
        modelRequests: [
          {
            id: "req-1",
            assetModelId: "model-1",
            quantity: 2,
            fulfilledQuantity: 0,
            fulfilledAt: null,
            assetModel: { id: "model-1", name: "Model One" },
          },
        ],
        bookingAssets: [
          {
            assetKitId: null,
            bookingModelRequestId: null,
            quantity: 1,
            asset: {
              id: "asset-free",
              title: "Free",
              type: "INDIVIDUAL",
              mainImage: null,
              thumbnailImage: null,
              assetKits: [],
            },
          },
          {
            assetKitId: null,
            bookingModelRequestId: "req-1",
            quantity: 1,
            asset: {
              id: "asset-stamped",
              title: "Stamped",
              type: "INDIVIDUAL",
              mainImage: null,
              thumbnailImage: null,
              assetKits: [],
            },
          },
        ],
      }) as unknown as Awaited<ReturnType<typeof getBooking>>
    );

    const { assignSession } = await runLoader();
    expect(
      assignSession?.alreadyIncluded.map((row) => [row.id, row.claimable])
    ).toEqual([
      ["asset-free", true],
      ["asset-stamped", false],
    ]);
  });
});
