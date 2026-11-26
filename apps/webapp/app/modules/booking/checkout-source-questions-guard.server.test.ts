/**
 * A quick check-out from a surface that cannot ask "From location" is refused
 * when the booking has that question to ask.
 *
 * The bookings-list row and the bulk check-out post without the dialog that
 * renders one select per multi-placed pool, so the overview action calls
 * `assertNoCheckoutSourceQuestions` for them. This suite pins both answers:
 * silence when every pool to go out sits at one placement or none, or already
 * has its sources planned or converts at this check-out (it goes out by
 * allocation), and the 400 with the "open the booking" message when a LEGACY
 * pool slice sits at two while adoption is off.
 *
 * @see {@link file://./checkout-source-location.server.ts}
 */
import { describe, expect, it, vi } from "vitest";
import { db } from "~/database/db.server";
import {
  assertNoCheckoutSourceQuestions,
  CHECKOUT_NEEDS_SOURCE_CHOICE_MESSAGE,
} from "./checkout-source-location.server";

// @vitest-environment node

// why: the question is read from the booking's slices and the pools'
// placements; the reads are stubbed per case below.
vi.mock("~/database/db.server", () => ({
  db: {
    bookingAsset: { findMany: vi.fn() },
    asset: { findMany: vi.fn() },
    assetLocation: { findMany: vi.fn() },
    custody: { findMany: vi.fn().mockResolvedValue([]) },
    // The rows of slices with planned sources; none planned anything here.
    bookingAssetSource: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

// why: units out on other bookings only move the "left" counts, which the
// question does not depend on; nothing is out here.
vi.mock("./units-out-by-source.server", () => ({
  loadBookedOutBySource: vi.fn().mockResolvedValue(new Map()),
  bookedOutFromLegacySourcedSlices: vi.fn().mockResolvedValue(new Map()),
  loadConvertedOutNow: vi.fn().mockResolvedValue([]),
  LEGACY_SOURCED_SLICE_WHERE: {},
}));

const ORG = "org-1";

/** One standalone quantity-tracked slice still to go out, and its pool. */
function poolWithPlacements(count: number) {
  vi.mocked(db.bookingAsset.findMany).mockResolvedValue([
    { id: "slice-1", assetId: "tape", quantity: 2 },
  ] as never);
  vi.mocked(db.asset.findMany).mockResolvedValue([
    { id: "tape", title: "Gaffer tape", quantity: 10, unitOfMeasure: null },
  ] as never);
  vi.mocked(db.assetLocation.findMany).mockResolvedValue(
    Array.from({ length: count }, (_, index) => ({
      assetId: "tape",
      locationId: `loc-${index + 1}`,
      quantity: 5,
      location: { name: `Room ${index + 1}` },
    })) as never
  );
}

describe("assertNoCheckoutSourceQuestions", () => {
  it("lets a booking with no slice left to go out through", async () => {
    vi.mocked(db.bookingAsset.findMany).mockResolvedValue([] as never);

    await expect(
      assertNoCheckoutSourceQuestions({ organizationId: ORG, bookingId: "b1" })
    ).resolves.toBeUndefined();
  });

  it("lets a pool at one placement through: the default location is the only answer", async () => {
    poolWithPlacements(1);

    await expect(
      assertNoCheckoutSourceQuestions({ organizationId: ORG, bookingId: "b1" })
    ).resolves.toBeUndefined();
  });

  it("refuses with 400 and the open-the-booking message when a LEGACY pool sits at two placements and adoption is off", async () => {
    poolWithPlacements(2);

    await expect(
      assertNoCheckoutSourceQuestions({
        organizationId: ORG,
        bookingId: "b1",
        adoptionEnabled: false,
      })
    ).rejects.toMatchObject({
      status: 400,
      message: CHECKOUT_NEEDS_SOURCE_CHOICE_MESSAGE,
      additionalData: { bookingId: "b1", sliceIds: ["slice-1"] },
    });
  });

  it("lets a LEGACY pool at two placements through when adoption is on: it converts and goes out by allocation", async () => {
    poolWithPlacements(2);

    await expect(
      assertNoCheckoutSourceQuestions({
        organizationId: ORG,
        bookingId: "b1",
        adoptionEnabled: true,
      })
    ).resolves.toBeUndefined();
  });

  it("lets a slice with planned sources through: it goes out by its plan", async () => {
    poolWithPlacements(2);
    vi.mocked(db.bookingAsset.findMany).mockResolvedValue([
      { id: "slice-1", assetId: "tape", quantity: 2, sourceAllocation: "AUTO" },
    ] as never);

    await expect(
      assertNoCheckoutSourceQuestions({ organizationId: ORG, bookingId: "b1" })
    ).resolves.toBeUndefined();
  });
});
