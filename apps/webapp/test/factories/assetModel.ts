import type { AssetModel } from "@prisma/client";

/**
 * Factory for creating AssetModel test data.
 * Produces a complete AssetModel object with sensible defaults.
 */
export function createAssetModel(
  overrides: Partial<AssetModel> = {}
): AssetModel {
  return {
    id: "asset-model-123",
    name: "Dell Latitude 5550",
    description: "Standard issue laptop",
    image: null,
    imageExpiration: null,
    defaultCategoryId: null,
    defaultValuation: null,
    organizationId: "org-123",
    userId: "user-123",
    createdAt: new Date("2023-01-01"),
    updatedAt: new Date("2023-01-01"),
    ...overrides,
  };
}
