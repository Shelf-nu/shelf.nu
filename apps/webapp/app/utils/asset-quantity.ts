/**
 * Asset quantity formatting helpers (Phase 4e).
 *
 * QUANTITY_TRACKED assets represent N fungible units (e.g. "Pens", 80 units);
 * their custody / kit / location / booking pivots each carry a per-row
 * `quantity`. Activity notes and events for these assets must surface that
 * per-row count ("50 units of Pens") sourced from the PIVOT row, not the asset
 * total. INDIVIDUAL assets are a single unit, so they get no count and their
 * phrasing stays exactly as before.
 *
 * These pure helpers centralise the "is this qty-tracked, and how do we phrase
 * the count" decision so every note/event site renders identically.
 *
 * @see {@link file://./markdoc-wrappers.ts} wrapAssetWithCountForNote — note-fragment composition
 */

import { AssetType } from "@prisma/client";

/** Minimal asset shape needed to decide on and label a unit count. */
export type AssetForUnitCount = {
  type: AssetType;
  unitOfMeasure?: string | null;
};

/**
 * Strips characters that could begin a Markdoc tag (`{`, `%`, `}`) from a
 * user-supplied label before it is embedded into Markdoc-rendered note
 * content. `unitOfMeasure` is the only user-controlled string interpolated
 * into system notes, and notes are rendered through Markdoc both on the
 * client (`MarkdownViewer`) and the CSV / PDF sanitiser — so a value like
 * `{% link to="/login" text="…" /%}` would otherwise turn every qty-tracked
 * system note about that asset into an attacker-styled badge / link.
 *
 * Real unit labels ("kg", "boxes", "pcs", "lbs") never contain these
 * characters, so the strip is lossless for legitimate input. Defence in
 * depth — the same characters are also rejected by the form-level Zod
 * refinement.
 */
export function sanitizeUnitOfMeasureLabel(
  value: string | null | undefined
): string {
  return (value ?? "").replace(/[{%}]/g, "").trim();
}

/**
 * Formats a per-row unit count for a quantity-tracked asset, e.g. `"50 units"`
 * or `"50 boxes"` (using the asset's `unitOfMeasure`, defaulting to "units").
 *
 * Returns `null` whenever the count should be omitted entirely — INDIVIDUAL
 * assets, or a missing / non-positive quantity — so callers fall back to their
 * existing (countless) phrasing without a conditional of their own.
 *
 * @param asset - The asset (its `type` decides whether a count applies)
 * @param quantity - The PIVOT-row quantity (Custody / AssetKit / AssetLocation
 *   / BookingAsset `.quantity`), NOT `Asset.quantity`
 * @returns A human label like `"50 units"`, or `null` to omit the count
 */
export function formatUnitCount(
  asset: AssetForUnitCount,
  quantity: number | null | undefined
): string | null {
  if (asset.type !== AssetType.QUANTITY_TRACKED) return null;
  if (quantity == null || quantity <= 0) return null;

  const label = sanitizeUnitOfMeasureLabel(asset.unitOfMeasure) || "units";
  return `${quantity} ${label}`;
}

/**
 * Builds the `meta.quantity` fragment for an `ActivityEvent`.
 *
 * Returns `{ quantity }` for a quantity-tracked asset with a positive count,
 * otherwise `{}` — so it can be spread into an existing `meta` object without
 * adding a noisy `quantity` key to INDIVIDUAL-asset events.
 *
 * @param asset - The asset (its `type` decides whether `quantity` is recorded)
 * @param quantity - The PIVOT-row quantity affected by the event
 * @returns `{ quantity }` or `{}` to spread into `recordEvent`'s `meta`
 */
export function assetQtyMeta(
  asset: AssetForUnitCount,
  quantity: number | null | undefined
): { quantity?: number } {
  if (asset.type !== AssetType.QUANTITY_TRACKED) return {};
  if (quantity == null || quantity <= 0) return {};
  return { quantity };
}
