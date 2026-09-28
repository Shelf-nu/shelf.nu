/**
 * Scanner Picker Meta — Unit Tests
 *
 * `getScannerPickerMeta` answers "how many units may this scan still stage
 * here" for the three destinations the QR scanner feeds. These tests cover the
 * BOOKING branch, whose answer has to be the same number the booking write
 * guard enforces with: the drawer caps its quantity input on it AND refuses a
 * scan when it reaches zero, so a locally-derived approximation would block an
 * add the server would have accepted.
 *
 * That is why the branch delegates to `getAssetAvailabilityBatch` rather than
 * summing the pool's parts itself, and why these tests assert the delegation
 * and its arguments rather than re-deriving an expected figure.
 *
 * @see {@link file://./picker-meta.server.ts}
 */
import { AssetType } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import type { AssetAvailability } from "~/modules/asset/availability.server";
import { getAssetAvailabilityBatch } from "~/modules/asset/availability.server";
import { getScannerPickerMeta } from "./picker-meta.server";

// why: the booking branch reads the asset row and the target booking from the
// db singleton; mock it so tests can pin those shapes without Postgres.
vi.mock("~/database/db.server", () => ({
  db: {
    asset: { findFirst: vi.fn() },
    booking: { findUnique: vi.fn() },
  },
}));

// why: this is the collaborator under test — the branch's whole contract is
// that it asks this primitive instead of computing the pool itself, so the
// call and its arguments are the assertion.
vi.mock("~/modules/asset/availability.server", () => ({
  getAssetAvailabilityBatch: vi.fn(),
}));

const findAssetMock = vi.mocked(db.asset.findFirst);
const findBookingMock = vi.mocked(db.booking.findUnique);
const availabilityMock = vi.mocked(getAssetAvailabilityBatch);

const BOOKING_FROM = new Date("2026-03-02T09:00:00.000Z");
const BOOKING_TO = new Date("2026-03-06T17:00:00.000Z");

const CONTEXT = { type: "booking", id: "booking-1" } as const;

/** A quantity-tracked asset with 10 units of stock. */
function qtyAsset(overrides: Record<string, unknown> = {}) {
  return {
    id: "asset-1",
    type: AssetType.QUANTITY_TRACKED,
    quantity: 10,
    unitOfMeasure: "pcs",
    ...overrides,
  };
}

/**
 * Answer the batch read with `bookable` for the asset under test.
 *
 * Only `bookable` is filled in: it is the single field this branch reads, and
 * pinning the rest would assert the primitive's shape rather than this one's
 * use of it.
 */
function mockBookable(bookable: number) {
  availabilityMock.mockResolvedValue(
    new Map([["asset-1", { bookable } as AssetAvailability]])
  );
}

describe("getScannerPickerMeta — booking context", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    findAssetMock.mockResolvedValue(qtyAsset() as never);
    findBookingMock.mockResolvedValue({
      id: "booking-1",
      from: BOOKING_FROM,
      to: BOOKING_TO,
    } as never);
  });

  it("reports the pool the shared availability primitive resolved", async () => {
    // A kit slice on an active booking is already inside the primitive's
    // `inKits` term. Subtracting it a second time — as any local re-derivation
    // over `BookingAsset` rows does — would report 0 here and disable the
    // drawer's Confirm while five units were genuinely free.
    mockBookable(5);

    const meta = await getScannerPickerMeta({
      assetId: "asset-1",
      organizationId: "org-1",
      context: CONTEXT,
    });

    expect(meta).toEqual({
      maxAllowed: 5,
      assetQuantity: 10,
      unitOfMeasure: "pcs",
    });
  });

  it("measures the booking's own window, excluding the booking itself", async () => {
    // Excluding the target booking is what makes this a top-up figure: its
    // existing rows are what the scan is adding to, not competition for it.
    mockBookable(4);

    await getScannerPickerMeta({
      assetId: "asset-1",
      organizationId: "org-1",
      context: CONTEXT,
    });

    expect(availabilityMock).toHaveBeenCalledWith(["asset-1"], {
      organizationId: "org-1",
      window: { from: BOOKING_FROM, to: BOOKING_TO },
      excludeBookingId: "booking-1",
    });
  });

  it("asks for an unwindowed pool when the booking has no dates", async () => {
    findBookingMock.mockResolvedValue({
      id: "booking-1",
      from: null,
      to: null,
    } as never);
    mockBookable(10);

    await getScannerPickerMeta({
      assetId: "asset-1",
      organizationId: "org-1",
      context: CONTEXT,
    });

    expect(availabilityMock).toHaveBeenCalledWith(
      ["asset-1"],
      expect.objectContaining({ window: null })
    );
  });

  it("clamps an over-committed pool to zero", async () => {
    // `bookable` is signed so write guards can tell "already over-committed"
    // from "exactly full". This number bounds a quantity input, so a negative
    // one has to surface as nothing left rather than as a negative MAX.
    mockBookable(-3);

    const meta = await getScannerPickerMeta({
      assetId: "asset-1",
      organizationId: "org-1",
      context: CONTEXT,
    });

    expect(meta?.maxAllowed).toBe(0);
  });

  it("treats an asset the batch read did not resolve as exhausted", async () => {
    availabilityMock.mockResolvedValue(new Map());

    const meta = await getScannerPickerMeta({
      assetId: "asset-1",
      organizationId: "org-1",
      context: CONTEXT,
    });

    expect(meta?.maxAllowed).toBe(0);
  });

  it("returns null for an INDIVIDUAL asset without reading availability", async () => {
    // The drawers render neither a quantity input nor an availability
    // annotation for these, so the pool is never computed for them.
    findAssetMock.mockResolvedValue(
      qtyAsset({ type: AssetType.INDIVIDUAL, quantity: null }) as never
    );

    const meta = await getScannerPickerMeta({
      assetId: "asset-1",
      organizationId: "org-1",
      context: CONTEXT,
    });

    expect(meta).toBeNull();
    expect(availabilityMock).not.toHaveBeenCalled();
  });

  it("returns null when the booking is outside the caller's organization", async () => {
    // The lookup is org-scoped, so a foreign booking id resolves to nothing
    // and must not fall through to an availability read.
    findBookingMock.mockResolvedValue(null as never);

    const meta = await getScannerPickerMeta({
      assetId: "asset-1",
      organizationId: "org-1",
      context: CONTEXT,
    });

    expect(meta).toBeNull();
    expect(availabilityMock).not.toHaveBeenCalled();
  });
});
