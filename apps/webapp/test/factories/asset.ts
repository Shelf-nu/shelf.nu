import type { Asset, AssetStatus } from "@prisma/client";

/**
 * Factory for creating Asset test data
 */
export function createAsset(overrides: Partial<Asset> = {}): Partial<Asset> {
  return {
    id: "asset-123",
    title: "Test Asset",
    description: "Test asset description",
    status: "AVAILABLE" as AssetStatus,
    organizationId: "org-789",
    categoryId: null,
    locationId: null,
    mainImage: null,
    mainImageExpiration: null,
    valuation: null,
    availableToBook: true,
    createdAt: new Date("2023-01-01"),
    updatedAt: new Date("2023-01-01"),
    ...overrides,
  };
}

/**
 * Factory for creating asset search results (with joined data)
 */
export function createAssetSearchResult(overrides: any = {}) {
  return {
    id: "asset-123",
    title: "Test Asset",
    sequentialId: "AS-001",
    mainImage: null,
    mainImageExpiration: null,
    locationName: null,
    description: null,
    qrCodes: [],
    categoryName: null,
    tagNames: [],
    custodianName: null,
    custodianUserName: null,
    barcodes: [],
    customFieldValues: [],
    ...overrides,
  };
}
