/**
 * Per-row quantity input, shared by the scanner drawers that move units:
 * location, kit, booking, assign custody and release custody.
 *
 *   - Clamped to [1, max].
 *   - Defaults to 1 — "scan to take one", edited up from there.
 *   - Stops click propagation so tapping it doesn't trigger the surrounding
 *     row's selection / remove behaviour.
 *
 * Laid out as a single compact line so it sits beside a row's title rather
 * than under it: a drawer renders it as a sibling of the row's text column,
 * inside a horizontal flex, and it keeps its intrinsic width there
 * (`shrink-0`).
 *
 * State lives in `scannedAssetQuantitiesAtom`, keyed by `assetId`, so the
 * drawer's clear / remove paths drop entries for free. This bound is a
 * display aid only — the services re-check the real pool on the write.
 */

import type { ChangeEvent } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  scannedAssetQuantitiesAtom,
  setScannedAssetQuantityAtom,
} from "~/atoms/qr-scanner";
import Input from "~/components/forms/input";

/**
 * @param assetId - The scanned asset's id; the key the form payload serialises
 *   this quantity under.
 * @param max - Units this row may move, as the drawer computes it.
 * @param unit - `Asset.unitOfMeasure` or `"units"`; rendered only when it is
 *   not the default literal, which would read as noise.
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
      className="flex shrink-0 items-center gap-1.5"
      role="presentation"
      onClick={(e) => e.stopPropagation()}
    >
      <label htmlFor={`scan-qty-${assetId}`} className="text-xs text-gray-500">
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
        className="w-16"
        // The shared Input is sized for a form field — 16px text on 14px
        // padding — which dwarfs a row it is meant to sit inside. These land
        // after the defaults in `tw()`, so they win.
        inputClassName="px-2 py-1 text-sm text-right"
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
      <span className="whitespace-nowrap text-xs text-gray-500">
        / {max}
        {unit !== "units" ? ` ${unit}` : ""}
      </span>
    </div>
  );
}
