/**
 * Schema contract for the bulk asset model dialogs.
 *
 * The assign and remove dialogs post to the SAME endpoint and are told apart
 * only by whether `assetModelId` is empty. A regression during development made
 * the endpoint reject the empty value, which silently broke removal while every
 * other gate stayed green, so the split is pinned here.
 *
 * @see {@link file://./bulk-asset-model-update-dialog.tsx}
 * @see {@link file://./bulk-asset-model-remove-dialog.tsx}
 * @see {@link file://./../../routes/api+/assets.bulk-update-asset-model.ts}
 */
import { describe, expect, it } from "vitest";
import {
  BulkAssetModelActionSchema,
  BulkAssetModelUpdateSchema,
} from "./bulk-asset-model-update-dialog";

describe("bulk asset model schemas", () => {
  it("accepts an empty assetModelId on the wire, because that is how removal is requested", () => {
    const result = BulkAssetModelActionSchema.safeParse({
      assetIds: ["asset-1"],
      assetModelId: "",
    });

    expect(result.success).toBe(true);
  });

  it("rejects an empty assetModelId in the assign form, so it cannot silently ungroup", () => {
    const result = BulkAssetModelUpdateSchema.safeParse({
      assetIds: ["asset-1"],
      assetModelId: "",
    });

    expect(result.success).toBe(false);
    expect(result.success ? null : result.error.issues[0]?.message).toBe(
      "Please select an asset model"
    );
  });

  it("accepts a model id in both", () => {
    const payload = { assetIds: ["asset-1"], assetModelId: "model-1" };

    expect(BulkAssetModelActionSchema.safeParse(payload).success).toBe(true);
    expect(BulkAssetModelUpdateSchema.safeParse(payload).success).toBe(true);
  });

  it("requires at least one asset in both, so a stray POST cannot target everything", () => {
    const payload = { assetIds: [], assetModelId: "model-1" };

    expect(BulkAssetModelActionSchema.safeParse(payload).success).toBe(false);
    expect(BulkAssetModelUpdateSchema.safeParse(payload).success).toBe(false);
  });
});
