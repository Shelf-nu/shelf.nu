import { describe, expect, it } from "vitest";
import { getAssetOverviewFields } from "./fields";

describe("getAssetOverviewFields", () => {
  const testAssetId = "asset-123";

  it("includes full barcodes relation when canUseBarcodes is true", () => {
    const result = getAssetOverviewFields(testAssetId, true);

    expect(result).toHaveProperty("barcodes", {
      select: { id: true, type: true, value: true },
    });
    expect(result).not.toHaveProperty("_count");
  });

  it("includes _count.barcodes (not full barcodes) when canUseBarcodes is false", () => {
    const result = getAssetOverviewFields(testAssetId, false);

    expect(result).toHaveProperty("_count", {
      select: { barcodes: true },
    });
    expect(result).not.toHaveProperty("barcodes");
  });

  it("defaults canUseBarcodes to false when omitted", () => {
    const result = getAssetOverviewFields(testAssetId);

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
      "location",
      "custody",
      "organization",
      "customFields",
      "kit",
      "bookingAssets",
    ];

    const withBarcodes = getAssetOverviewFields(testAssetId, true);
    const withoutBarcodes = getAssetOverviewFields(testAssetId, false);

    for (const key of baseKeys) {
      expect(withBarcodes).toHaveProperty(key);
      expect(withoutBarcodes).toHaveProperty(key);
    }
  });

  it("bookingAssets NOT filter uses the provided assetId", () => {
    const assetId = "my-unique-asset-id";
    const result = getAssetOverviewFields(assetId, false);

    const bookingAssets = result.bookingAssets as {
      where: {
        booking: {
          NOT: {
            partialCheckins: { some: { assetIds: { has: string } } };
          };
        };
      };
    };

    expect(
      bookingAssets.where.booking.NOT.partialCheckins.some.assetIds.has
    ).toBe(assetId);
  });
});
