/**
 * How many units each custody scanner may move for a scanned row, and the
 * `quantities` field the drawers submit off the back of it.
 *
 * Both custody routes discriminate on key PRESENCE: an asset id listed in
 * `quantities` is handed over unit by unit, one absent from it is handed over
 * whole and — being quantity-tracked — skipped by the bulk service. So an
 * omission is not a smaller request, it is a different one, and a row that
 * quietly fails to appear here is a row that silently does nothing.
 *
 * That is the trap this helper exists to close. `ScannedAssetQuantityInput`
 * displays 1 for a row with no entry but writes the atom only when the
 * operator edits the field, so reading the atom's keys alone drops exactly the
 * rows that accepted the default — the ordinary one-unit hand-over. Every
 * submitted row that shows an input is emitted here instead, falling back to
 * the same 1 the field displays.
 *
 * @see {@link file://./uses/assign-custody-drawer.tsx}
 * @see {@link file://./uses/release-custody-drawer.tsx}
 */

import type { ScanListItems } from "~/atoms/qr-scanner";
import { isQuantityTracked } from "~/modules/asset/utils";
import type { AssetFromQr } from "~/routes/api+/get-scanned-item.$qrId";

/**
 * Units an assign scan may hand over, from the server's own custody pool
 * (`pickerMeta.maxAllowed`). Falls back to the asset's stock when the API
 * answered without picker meta, which keeps the row usable and leaves the
 * write to refuse an over-allocation.
 */
export function assignableUnits(asset: AssetFromQr): number {
  return asset.pickerMeta?.maxAllowed ?? asset.quantity ?? 0;
}

/**
 * Units a release scan may hand back.
 *
 * Only operator-assigned rows count. A `Custody` row carrying a `kitCustodyId`
 * was inherited from the kit's own custody and goes back by releasing the kit,
 * which cascade-deletes it — the route's holder lookup and `releaseQuantity`
 * both scope themselves to `kitCustodyId: null`, so counting the kit rows here
 * would offer a ceiling the write can never honour.
 *
 * Which of these units the chosen custodian holds is settled on the write by
 * `releaseQuantity`, which refuses with the number they do hold.
 */
export function releasableUnits(asset: AssetFromQr): number {
  return (asset.custody ?? [])
    .filter((row) => row.kitCustodyId == null)
    .reduce((sum, row) => sum + (row.quantity ?? 0), 0);
}

/**
 * @param args.items - The scanned rows, keyed by the code that resolved them.
 * @param args.assetIds - Asset ids in this submission. Rows outside it are
 *   skipped, so a row scanned and then removed cannot carry a stale number.
 * @param args.assetQuantities - Per-asset units the operator typed, if any.
 * @param args.unitsFor - How many units this drawer may move for an asset —
 *   the same number its row bounds the input by. A row worth zero shows no
 *   input and is left off the payload, keeping today's whole-asset treatment.
 * @returns `assetId → units`, one entry per quantity-tracked row on show.
 */
export function buildQuantitiesPayload({
  items,
  assetIds,
  assetQuantities,
  unitsFor,
}: {
  items: ScanListItems;
  assetIds: string[];
  assetQuantities: Record<string, number>;
  unitsFor: (asset: AssetFromQr) => number;
}): Record<string, number> {
  const submitted = new Set(assetIds);
  const payload: Record<string, number> = {};

  for (const item of Object.values(items)) {
    if (item?.type !== "asset") continue;

    const asset = item.data as AssetFromQr | undefined;
    if (!asset || !submitted.has(asset.id)) continue;
    if (!isQuantityTracked(asset) || unitsFor(asset) <= 0) continue;

    payload[asset.id] = assetQuantities[asset.id] ?? 1;
  }

  return payload;
}
