/**
 * Per-row qty input shared by the three Phase 4b scanner drawers
 * (location, kit, booking). Mirrors the manage-assets picker UX:
 *
 *   - Clamped to [1, asset.quantity].
 *   - Defaults to 1 (matches "scan to add one" intent — users edit up
 *     from there).
 *   - Stop-click-propagation so tapping the input doesn't trigger the
 *     surrounding row's selection / remove behaviour.
 *
 * State lives in `scannedAssetQuantitiesAtom` (jotai), keyed by
 * `assetId` — drawer clear / remove paths automatically drop entries.
 * Server-side enforcement (strict-available pool) still runs in
 * `updateLocationAssets` / `updateKitAssets` / `addScannedAssetsToBooking`;
 * this input only guards the [1, asset.quantity] *display* range.
 */

import type { ChangeEvent } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  scannedAssetQuantitiesAtom,
  setScannedAssetQuantityAtom,
} from "~/atoms/qr-scanner";
import Input from "~/components/forms/input";

/**
 * @param assetId — the scanned asset's id; same id the form payload
 *   uses as a key when serialising the qty map.
 * @param max — `Asset.quantity` for the row; the input's MAX bound.
 * @param unit — `Asset.unitOfMeasure` or `"units"`; only rendered when
 *   it's not the default literal (avoids redundant "units" labels).
 */
export function ScannedAssetQuantityInput({
  assetId,
  max,
  unit,
}: {
  assetId: string;
  max: number;
  unit: string;
}) {
  const quantities = useAtomValue(scannedAssetQuantitiesAtom);
  const setQuantity = useSetAtom(setScannedAssetQuantityAtom);
  const value = quantities[assetId] ?? 1;

  return (
    <div
      className="flex shrink-0 flex-col items-end gap-1"
      role="presentation"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1">
        <label
          htmlFor={`scan-qty-${assetId}`}
          className="text-xs text-gray-500"
        >
          Qty
        </label>
        <Input
          id={`scan-qty-${assetId}`}
          label="Quantity"
          hideLabel
          type="number"
          inputMode="numeric"
          min={1}
          max={max}
          step={1}
          value={value}
          className="w-20"
          inputClassName="text-right"
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            const raw = e.currentTarget.value;
            if (raw === "") {
              setQuantity({ assetId, quantity: undefined });
              return;
            }
            const parsed = Number.parseInt(raw, 10);
            if (Number.isNaN(parsed) || parsed < 1) return;
            setQuantity({
              assetId,
              quantity: Math.min(parsed, max),
            });
          }}
        />
        <span className="text-xs text-gray-500">/ {max}</span>
      </div>
      {unit !== "units" ? (
        <span className="text-[10px] text-gray-400">{unit}</span>
      ) : null}
    </div>
  );
}
