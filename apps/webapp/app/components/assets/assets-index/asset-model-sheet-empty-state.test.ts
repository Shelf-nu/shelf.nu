/**
 * Asset Model Sheet Empty State: tests
 *
 * The sheet's empty message is the only place the operator learns WHY a bucket
 * came back with nothing: filters that exclude everything in it, or a bucket
 * holding nothing at all. Getting that backwards sends someone to add assets to
 * a model that already has fifty, so the wording is pinned per case.
 *
 * No mocks: the function under test is pure, which is why the wording lives
 * outside the sheet component.
 *
 * @see {@link file://./asset-model-sheet-empty-state.ts}
 */
import { describe, expect, it } from "vitest";
import { describeEmptyAssetModelSheet } from "./asset-model-sheet-empty-state";

describe("describeEmptyAssetModelSheet", () => {
  it("reports how many of a model's assets the filters exclude", () => {
    expect(
      describeEmptyAssetModelSheet({
        bucketKind: "model",
        unfilteredAssets: 52,
      })
    ).toBe("None match your filters. This model has 52 assets outside them.");
  });

  it("agrees with a single excluded asset", () => {
    // "1 assets" is the giveaway that a count was interpolated without its
    // noun, and one excluded asset is the commonest of these cases.
    expect(
      describeEmptyAssetModelSheet({
        bucketKind: "model",
        unfilteredAssets: 1,
      })
    ).toBe("None match your filters. This model has 1 asset outside them.");
  });

  it("says a model holds nothing rather than claiming assets outside the filters", () => {
    const message = describeEmptyAssetModelSheet({
      bucketKind: "model",
      unfilteredAssets: 0,
    });

    expect(message).toBe("This model has no assets yet.");
    // A model with nothing in it is an ordinary row of this view, so the
    // filters-excluded sentence must not be reached for it: it would read as
    // "has 0 assets outside them".
    expect(message).not.toContain("outside them");
  });

  it("describes the no-model bucket as assets without a model, never as a model", () => {
    const message = describeEmptyAssetModelSheet({
      bucketKind: "unassigned",
      unfilteredAssets: 7,
    });

    expect(message).toBe(
      "None match your filters. 7 assets without a model fall outside them."
    );
    // The bucket is the absence of a model, so no sentence about it may call it
    // one.
    expect(message).not.toContain("This model");
  });

  it("agrees with a single asset without a model, verb included", () => {
    expect(
      describeEmptyAssetModelSheet({
        bucketKind: "unassigned",
        unfilteredAssets: 1,
      })
    ).toBe(
      "None match your filters. 1 asset without a model falls outside them."
    );
  });

  it("claims nothing about size when the count was not reported", () => {
    // A response carrying no count must not be read as a count of zero: that
    // describes a full model as empty, which is worse than saying less.
    expect(
      describeEmptyAssetModelSheet({
        bucketKind: "model",
        unfilteredAssets: null,
      })
    ).toBe("No assets match your filters.");
    expect(
      describeEmptyAssetModelSheet({
        bucketKind: "unassigned",
        unfilteredAssets: null,
      })
    ).toBe("No assets match your filters.");
  });
});
