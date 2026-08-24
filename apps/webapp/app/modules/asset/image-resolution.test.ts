/**
 * Tests for the asset image cascade.
 *
 * @see {@link file://./image-resolution.ts}
 */
import { describe, expect, it } from "vitest";
import {
  ASSET_IMAGE_PLACEHOLDER,
  resolveAssetImage,
  serializeAssetImage,
} from "./image-resolution";

describe("resolveAssetImage", () => {
  it("prefers the asset's own image over its model's", () => {
    expect(
      resolveAssetImage({
        mainImage: "https://cdn/asset-main.jpg",
        thumbnailImage: "https://cdn/asset-thumb.jpg",
        assetModel: {
          image: "https://cdn/model-main.jpg",
          thumbnailImage: "https://cdn/model-thumb.jpg",
        },
      })
    ).toEqual({
      fullUrl: "https://cdn/asset-main.jpg",
      thumbnailUrl: "https://cdn/asset-thumb.jpg",
      source: "asset",
    });
  });

  it("falls back to the model's image when the asset has none", () => {
    expect(
      resolveAssetImage({
        mainImage: null,
        thumbnailImage: null,
        assetModel: {
          image: "https://cdn/model-main.jpg",
          thumbnailImage: "https://cdn/model-thumb.jpg",
        },
      })
    ).toEqual({
      fullUrl: "https://cdn/model-main.jpg",
      thumbnailUrl: "https://cdn/model-thumb.jpg",
      source: "model",
    });
  });

  it("falls back to the placeholder with no image and no model", () => {
    expect(
      resolveAssetImage({
        mainImage: null,
        thumbnailImage: null,
        assetModel: null,
      })
    ).toEqual({
      fullUrl: ASSET_IMAGE_PLACEHOLDER,
      thumbnailUrl: ASSET_IMAGE_PLACEHOLDER,
      source: "placeholder",
    });
  });

  it("falls back to the placeholder when the model has no image", () => {
    expect(
      resolveAssetImage({
        mainImage: null,
        thumbnailImage: null,
        assetModel: { image: null, thumbnailImage: null },
      }).source
    ).toBe("placeholder");
  });

  // why: the tier is decided by mainImage ALONE. An asset whose image was
  // cleared but whose thumbnailImage row value lingered must not render a
  // thumbnail of an image it no longer has.
  it("ignores a stale asset thumbnail when the asset has no main image", () => {
    expect(
      resolveAssetImage({
        mainImage: null,
        thumbnailImage: "https://cdn/stale-thumb.jpg",
        assetModel: {
          image: "https://cdn/model-main.jpg",
          thumbnailImage: "https://cdn/model-thumb.jpg",
        },
      })
    ).toEqual({
      fullUrl: "https://cdn/model-main.jpg",
      thumbnailUrl: "https://cdn/model-thumb.jpg",
      source: "model",
    });
  });

  it("uses the full-size url as the thumbnail within the winning tier", () => {
    expect(
      resolveAssetImage({
        mainImage: "https://cdn/asset-main.jpg",
        thumbnailImage: null,
        assetModel: null,
      }).thumbnailUrl
    ).toBe("https://cdn/asset-main.jpg");

    expect(
      resolveAssetImage({
        mainImage: null,
        thumbnailImage: null,
        assetModel: {
          image: "https://cdn/model-main.jpg",
          thumbnailImage: null,
        },
      }).thumbnailUrl
    ).toBe("https://cdn/model-main.jpg");
  });
});

describe("serializeAssetImage", () => {
  it("flattens an inherited image into the asset's own image fields", () => {
    expect(
      serializeAssetImage({
        id: "asset-1",
        title: "Camera",
        mainImage: null,
        thumbnailImage: null,
        assetModel: {
          image: "https://cdn/model-main.jpg",
          thumbnailImage: "https://cdn/model-thumb.jpg",
        },
      })
    ).toEqual({
      id: "asset-1",
      title: "Camera",
      mainImage: "https://cdn/model-main.jpg",
      thumbnailImage: "https://cdn/model-thumb.jpg",
      imageSource: "model",
    });
  });

  // why: the companion renders its own placeholder when mainImage is null, so
  // emitting the placeholder PATH here would break that branch on every asset
  // that has no image at all.
  it("keeps the image fields null for the placeholder case", () => {
    expect(
      serializeAssetImage({
        id: "asset-1",
        mainImage: null,
        thumbnailImage: null,
        assetModel: null,
      })
    ).toEqual({
      id: "asset-1",
      mainImage: null,
      thumbnailImage: null,
      imageSource: "placeholder",
    });
  });

  it("drops the nested assetModel from the payload", () => {
    const result = serializeAssetImage({
      id: "asset-1",
      mainImage: "https://cdn/asset-main.jpg",
      thumbnailImage: null,
      assetModel: { image: "https://cdn/model-main.jpg", thumbnailImage: null },
    });

    expect(result).not.toHaveProperty("assetModel");
    expect(result.imageSource).toBe("asset");
  });
});
