/**
 * Synthetic "still to pull" rows for a booking's outstanding model
 * reservations.
 *
 * A pending row is not backed by any `BookingAsset`: it stands in for one
 * unit of an `AssetModel` reservation that has neither been matched by an
 * in-session scan nor materialised in an earlier session. Both booking
 * scanners render one row per pending unit so the operator sees, up front,
 * exactly what is still expected.
 *
 * Pure, so a route or component can build the row list without mounting a
 * drawer.
 *
 * @see {@link file://./model-progress-strips.tsx} for the per-model
 *   progress summary these rows correspond to.
 */

/**
 * Fulfilment progress for one reserved `AssetModel`, used both to render the
 * progress strips and to derive pending rows.
 *
 * - `booked` is the original `BookingModelRequest.quantity` (denominator).
 * - `remaining` is the outstanding count still to fulfil: `booked` minus
 *   units already materialised into concrete `BookingAsset` rows.
 * - `prefulfilled` is `booked - remaining`: units materialised before this
 *   scan session opened.
 * - `matched` is the count of in-session scans that correctly matched this
 *   model.
 */
export type ModelProgress = {
  assetModelId: string;
  assetModelName: string;
  booked: number;
  remaining: number;
  prefulfilled: number;
  matched: number;
};

/**
 * One synthetic row standing in for a single unit of a model reservation
 * that is still outstanding after in-session scans are counted.
 *
 * `indexInModel` distinguishes rows for the same model (there is no
 * concrete asset id to key on yet), and `key` is the stable React key built
 * from it.
 */
export type PendingModelRow = {
  key: string;
  assetModelId: string;
  assetModelName: string;
  indexInModel: number;
};

/**
 * Builds one pending row per unit still outstanding on each reserved model.
 *
 * @param progressByModel - Fulfilment progress for every reserved model.
 * @returns One `PendingModelRow` per unit of `remaining - matched`, in the
 *   order `progressByModel` was given.
 */
export function buildPendingModelRows(
  progressByModel: ModelProgress[]
): PendingModelRow[] {
  const rows: PendingModelRow[] = [];
  for (const model of progressByModel) {
    // Pending rows = outstanding (remaining) minus in-session scans. Do NOT
    // use `booked` here: that would render pending rows for units that were
    // already materialised in previous scans and are now sitting as
    // concrete BookingAssets in "Already included".
    const pending = Math.max(0, model.remaining - model.matched);
    for (let i = 0; i < pending; i += 1) {
      rows.push({
        key: `pending-${model.assetModelId}-${i}`,
        assetModelId: model.assetModelId,
        assetModelName: model.assetModelName,
        indexInModel: i,
      });
    }
  }
  return rows;
}
