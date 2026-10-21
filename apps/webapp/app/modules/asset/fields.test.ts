import { describe, expect, it } from "vitest";
import { CURRENT_BOOKING_SLICE_FILTER, getAssetOverviewFields } from "./fields";

describe("getAssetOverviewFields", () => {
  it("includes full barcodes relation when canUseBarcodes is true", () => {
    const result = getAssetOverviewFields(true);

    expect(result).toHaveProperty("barcodes", {
      select: { id: true, type: true, value: true },
    });
    expect(result).not.toHaveProperty("_count");
  });

  it("includes _count.barcodes (not full barcodes) when canUseBarcodes is false", () => {
    const result = getAssetOverviewFields(false);

    expect(result).toHaveProperty("_count", {
      select: { barcodes: true },
    });
    expect(result).not.toHaveProperty("barcodes");
  });

  it("defaults canUseBarcodes to false when omitted", () => {
    const result = getAssetOverviewFields();

    expect(result).toHaveProperty("_count", {
      select: { barcodes: true },
    });
    expect(result).not.toHaveProperty("barcodes");
  });

  it("always includes base fields (qrCodes, bookingAssets, custody, etc.) regardless of flag", () => {
    const baseKeys = [
      "category",
      "qrCodes",
      "tags",
      "assetLocations",
      "custody",
      "organization",
      "customFields",
      "assetKits",
      "bookingAssets",
    ];

    const withBarcodes = getAssetOverviewFields(true);
    const withoutBarcodes = getAssetOverviewFields(false);

    for (const key of baseKeys) {
      expect(withBarcodes).toHaveProperty(key);
      expect(withoutBarcodes).toHaveProperty(key);
    }
  });
});

describe("getAssetOverviewFields — bookingAssets", () => {
  it("reads the booking the asset is out on from its slice markers", () => {
    // The overview shows ONE booking, taken as `bookingAssets[0]`, and the
    // loader derives nothing further from it. So the query must narrow the
    // relation to the slice that is out: it left (`checkedOutAt`) and nothing
    // brought it back (`checkedInAt`). Booking status alone is not enough — an
    // asset out on an overdue booking can also be booked onto a later one that
    // has since started — and check-in sessions are not a record of what is
    // out, so neither may stand in for the markers.
    const result = getAssetOverviewFields(true);

    expect(result.bookingAssets.where).toEqual({
      checkedOutAt: { not: null },
      checkedInAt: null,
      booking: { status: { in: ["ONGOING", "OVERDUE"] } },
    });
    // Newest departure first, so a second slice that is somehow still out
    // cannot put an older booking at the front.
    expect(result.bookingAssets.orderBy).toEqual({ checkedOutAt: "desc" });
  });

  it("uses the shared filter the mobile asset endpoint reads", () => {
    expect(getAssetOverviewFields(false).bookingAssets).toMatchObject(
      CURRENT_BOOKING_SLICE_FILTER
    );
  });
});
