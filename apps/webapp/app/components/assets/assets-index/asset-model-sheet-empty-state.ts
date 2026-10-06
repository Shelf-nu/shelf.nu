/**
 * Asset Model Sheet Empty State
 *
 * The one sentence the drill-down sheet shows when a bucket's filtered asset
 * list comes back empty.
 *
 * An empty sheet has two very different causes and the operator cannot tell
 * them apart from the rows: a model whose assets are all excluded by the
 * filters in force, and a model that holds nothing at all. The first is a cue
 * to widen the filters, the second a cue to add assets, so the message names
 * which one it is by reporting how many assets the bucket holds when the
 * filters are ignored.
 *
 * A pure function rather than JSX in the sheet: the wording is the part worth
 * pinning, and the sheet's own import graph reaches the whole advanced asset
 * table.
 *
 * @see {@link file://./asset-model-assets-sheet.tsx} The sheet that renders it
 * @see {@link file://./../../../modules/asset-model/bucket-assets.server.ts}
 *   Supplies the unfiltered count
 */
import type { AssetModelBucket } from "~/modules/asset-model/bucket";

/**
 * Renders a count with the noun it agrees with, so no message reads
 * "1 assets".
 *
 * @param count - How many assets to name
 * @returns The count and its noun, for example `1 asset` or `52 assets`
 */
function countAssets(count: number): string {
  return `${count} ${count === 1 ? "asset" : "assets"}`;
}

/**
 * The message for a drill-down sheet whose filtered asset list is empty.
 *
 * Call it only for an empty list: with rows on screen the sheet states its
 * count instead, and this sentence would contradict them.
 *
 * @param bucketKind - Which row the sheet was opened from. The "No model"
 *   bucket is not a model, so it cannot be described as one.
 * @param unfilteredAssets - How many assets the bucket holds with the filters
 *   ignored, or `null` when the endpoint did not report it. A response without
 *   the figure falls back to a message that claims nothing about the bucket's
 *   size, rather than to a `0` that would describe a full model as empty.
 * @returns One sentence, ready to render as-is
 */
export function describeEmptyAssetModelSheet({
  bucketKind,
  unfilteredAssets,
}: {
  bucketKind: AssetModelBucket["kind"];
  unfilteredAssets: number | null;
}): string {
  if (unfilteredAssets === null) {
    return "No assets match your filters.";
  }

  if (bucketKind === "model") {
    return unfilteredAssets === 0
      ? "This model has no assets yet."
      : `None match your filters. This model has ${countAssets(
          unfilteredAssets
        )} outside them.`;
  }

  // The bucket holds the assets carrying no model, so there is no "this bucket
  // is empty" state worth naming: a bucket with nothing in it is not listed at
  // all, and "every asset has a model" would overstate it, since a
  // quantity-tracked asset never carries one and never appears in this view.
  if (unfilteredAssets === 0) {
    return "No assets match your filters.";
  }

  // The verb agrees with the count, the same way the noun does.
  const fall = unfilteredAssets === 1 ? "falls" : "fall";

  return `None match your filters. ${countAssets(
    unfilteredAssets
  )} without a model ${fall} outside them.`;
}
