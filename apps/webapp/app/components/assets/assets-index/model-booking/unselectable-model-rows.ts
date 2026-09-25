/**
 * Which rows of the asset index's model view may not be selected.
 *
 * The model view lists one row per asset model plus a synthetic "No model"
 * bucket. That bucket is not a model: it has no units to reserve, so no
 * booking can be made from it. It still has to render — it is what answers
 * "which of my assets have no model assigned" — so it is registered as a
 * disabled bulk item rather than filtered out of the list, which keeps the
 * information on screen while its checkbox refuses.
 *
 * Kept in its own module so the rule can be asserted without mounting the
 * asset index, which needs the whole index loader to render at all.
 *
 * @see {@link file://./../assets-list.tsx} — registers the result
 * @see {@link file://./../../../../atoms/list.ts} — `setDisabledBulkItemsAtom`
 */

/**
 * The one field the decision reads.
 *
 * `assetModelId` is `null` on the "No model" bucket and on nothing else, which
 * is what makes it the discriminator.
 */
export type ModelRowSelectability = { assetModelId: string | null };

/**
 * Picks the model-view rows whose checkbox must refuse a click.
 *
 * @param rows - Every row the model view renders, in render order
 * @returns The subset to register in `disabledBulkItemsAtom`
 */
export function getUnselectableModelRows<T extends ModelRowSelectability>(
  rows: T[]
): T[] {
  return rows.filter((row) => row.assetModelId === null);
}
