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

/** A row the picker is rendering. Only rendered rows can be disabled. */
export type PickerRow = { id: string };

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
 * The count runs over the whole selection, not over the rows on screen: the
 * selection survives paging and searching, so a unit can be holding one of a
 * model's slots from a page the picker is not currently showing. `rows` only
 * decides what may be disabled, since a row that is not rendered cannot be.
 *
 * `modelIdByAssetId` is the source of truth for which model a unit belongs to,
 * and it is accumulated from the typed loader payload. Reading the model off a
 * selected row instead would go through `ListItemData`, whose index signature
 * types every field access as `any` — a renamed field would read as undefined
 * forever with nothing to catch it.
 *
 * @param args.rows - The rows rendered right now
 * @param args.modelIdByAssetId - Which model each asset the picker has shown belongs to
 * @param args.selectedAssetIds - Ids currently selected, across pages and searches
 * @param args.alreadyOnBookingIds - Ids the booking already holds
 * @param args.modelHeadroom - How many more units of a model may be taken
 * @returns The ids to disable, empty when nothing is capped
 */
export function assetIdsBlockedByModelHeadroom({
  rows,
  modelIdByAssetId,
  selectedAssetIds,
  alreadyOnBookingIds,
  modelHeadroom,
}: {
  rows: PickerRow[];
  modelIdByAssetId: ReadonlyMap<string, string>;
  selectedAssetIds: Set<string>;
  alreadyOnBookingIds: Set<string>;
  modelHeadroom: Record<string, number>;
}): Set<string> {
  const blocked = new Set<string>();
  if (Object.keys(modelHeadroom).length === 0) return blocked;

  const selectedPerModel = new Map<string, number>();
  for (const assetId of selectedAssetIds) {
    if (alreadyOnBookingIds.has(assetId)) continue;
    const assetModelId = modelIdByAssetId.get(assetId);
    if (!assetModelId || modelHeadroom[assetModelId] === undefined) continue;
    selectedPerModel.set(
      assetModelId,
      (selectedPerModel.get(assetModelId) ?? 0) + 1
    );
  }

  for (const row of rows) {
    const assetModelId = modelIdByAssetId.get(row.id);
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
