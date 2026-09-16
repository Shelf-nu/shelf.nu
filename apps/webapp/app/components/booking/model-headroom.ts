/**
 * Model headroom for the booking asset picker.
 *
 * A model another booking has reserved unnamed units of has a limit on how
 * many more of its units this booking may take by name. The server measures
 * the whole batch at once, so a picker that only marks units unavailable one
 * at a time lets a user select past the limit and meet a 400 on Confirm. This
 * turns the per-model limit into per-row disabling as the selection grows.
 *
 * @see {@link file://./../../routes/_layout+/bookings.$bookingId.overview.manage-assets.tsx} — where the limit is computed and applied
 * @see {@link file://./../../modules/booking-model-request/service.server.ts} — `assertModelUnitsNotReservedElsewhere`, the refusal this mirrors
 */

/** The fields of a picker row this decision reads. */
export type RowWithModel = {
  id: string;
  assetModelId?: string | null;
};

/**
 * The rows that must be disabled because their model has no room left for
 * another unit of it in this selection.
 *
 * Units already on the booking never consume headroom: the server counts them
 * on the booking's side of the pool, not as an addition. Rows that are
 * themselves selected are never disabled either, or a user who reaches the
 * limit could no longer undo the selection that reached it.
 *
 * Only models present in `modelHeadroom` are capped — every other model is
 * either uncontested or already fully flagged, and says nothing here.
 *
 * Selection survives pagination, but a model can only be resolved for rows on
 * the current page, so units of one model selected across two pages are
 * counted per page. The server still measures the whole batch and refuses,
 * naming the limit.
 *
 * @param args.rows - The rows rendered on this page
 * @param args.selectedAssetIds - Ids currently selected, across pages
 * @param args.alreadyOnBookingIds - Ids the booking already holds
 * @param args.modelHeadroom - How many more units of a model may be taken
 * @returns The ids to disable, empty when nothing is capped
 */
export function assetIdsBlockedByModelHeadroom({
  rows,
  selectedAssetIds,
  alreadyOnBookingIds,
  modelHeadroom,
}: {
  rows: RowWithModel[];
  selectedAssetIds: Set<string>;
  alreadyOnBookingIds: Set<string>;
  modelHeadroom: Record<string, number>;
}): Set<string> {
  const blocked = new Set<string>();
  if (Object.keys(modelHeadroom).length === 0) return blocked;

  const selectedPerModel = new Map<string, number>();
  for (const row of rows) {
    const { assetModelId } = row;
    if (!assetModelId || modelHeadroom[assetModelId] === undefined) continue;
    if (alreadyOnBookingIds.has(row.id)) continue;
    if (!selectedAssetIds.has(row.id)) continue;
    selectedPerModel.set(
      assetModelId,
      (selectedPerModel.get(assetModelId) ?? 0) + 1
    );
  }

  for (const row of rows) {
    const { assetModelId } = row;
    if (!assetModelId) continue;
    const headroom = modelHeadroom[assetModelId];
    if (headroom === undefined) continue;
    if (alreadyOnBookingIds.has(row.id) || selectedAssetIds.has(row.id))
      continue;
    if ((selectedPerModel.get(assetModelId) ?? 0) >= headroom) {
      blocked.add(row.id);
    }
  }

  return blocked;
}
