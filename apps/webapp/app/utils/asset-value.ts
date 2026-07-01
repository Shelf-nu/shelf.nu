/**
 * Asset value helpers — single source of truth for "total value" math.
 *
 * `Asset.valuation` is stored **per unit** by schema (one Pen costs €1, even
 * when the Pens asset row has `quantity: 100`). Pre-Wave-B every asset was
 * effectively `quantity: 1`, so "valuation" and "total value" were the same
 * number — no UI ever had to distinguish them. With QUANTITY_TRACKED assets
 * the two diverge: dashboards / location / kit / booking totals that sum
 * `valuation` without multiplying by `quantity` silently underreport.
 *
 * This module centralises the multiplication in ONE place so:
 *
 *   - Every JS surface (cells, tooltips, aggregates over already-loaded
 *     assets) reaches for {@link getAssetTotalValue}.
 *   - Raw-SQL aggregates (`SUM(valuation * quantity)` in `$queryRaw`)
 *     stay numerically consistent with the JS helper. If you change the
 *     math here, update the SQL fragments in `modules/reports/*` and
 *     friends to match — they intentionally mirror this expression.
 *
 * INDIVIDUAL assets are always `quantity: 1` (DB CHECK), so the helper
 * collapses to "return valuation" for them — no behaviour change.
 *
 * @see {@link file://./asset-quantity.ts} formatUnitCount — produces the
 *   "× 100 boxes" suffix surfaced alongside the totals.
 * @see {@link file://./currency.ts} formatCurrency — used to render each
 *   monetary string in the workspace's currency + locale.
 * @see {@link file://./../modules/asset/utils.ts} isQuantityTracked — call
 *   sites still gate UI on this; this helper is type-safe for both kinds.
 */

import type { AssetType, Currency } from "@prisma/client";

import { formatUnitCount } from "./asset-quantity";
import { formatCurrency } from "./currency";

/**
 * Minimal asset shape needed to compute total value.
 *
 * - `valuation` is the per-unit price (nullable: assets may have no price set).
 * - `quantity` is the total stock count (optional; treated as 1 when missing,
 *   which matches the DB CHECK constraint for INDIVIDUAL assets).
 * - `type` and `unitOfMeasure` are optional — only needed by the breakdown
 *   formatter to label the suffix and decide whether to surface it at all.
 */
export type AssetForValue = {
  type?: AssetType | null;
  valuation: number | null;
  quantity?: number | null;
  unitOfMeasure?: string | null;
};

/**
 * Returns the TOTAL monetary value of an asset: `valuation × quantity`.
 *
 * Designed for both INDIVIDUAL and QUANTITY_TRACKED assets:
 *
 *   - INDIVIDUAL → `quantity` is always 1, so result === `valuation ?? 0`.
 *   - QT with quantity > 1 → result is the multiplied total.
 *
 * Edge cases:
 *
 *   - `valuation: null` → returns 0 (no price set means no contribution).
 *   - `quantity: null` / `undefined` → treated as 1 (matches the schema
 *     default for INDIVIDUAL and avoids exploding when callers project the
 *     asset without `quantity`). Caller should still include `quantity` in
 *     the Prisma `select` for QT assets — see CLAUDE.md "Loader audit".
 *   - `valuation: 0` with `quantity > 0` → returns 0 (free items × N is 0).
 *
 * @param asset - The asset (only `valuation` and `quantity` are read here).
 * @returns The total value as a plain number (caller formats to currency).
 */
export function getAssetTotalValue(asset: AssetForValue): number {
  const unitValue = asset.valuation ?? 0;
  const quantity = asset.quantity ?? 1;
  return unitValue * quantity;
}

/**
 * Options for the breakdown formatter — workspace currency + UI locale.
 *
 * Mirrors `formatCurrency`'s signature so callers can pass the same
 * `{ currency, locale }` they already build for other monetary fields.
 */
export type FormatAssetValueOptions = {
  currency: Currency;
  locale: string;
};

/**
 * The three pieces of a breakdown display:
 *
 *   - `total`  — always populated; the currency-formatted total value
 *     (e.g. `"€100.00"`).
 *   - `unit`   — the per-unit price formatted with the same currency, or
 *     `null` when there's no useful breakdown to surface.
 *   - `suffix` — the human "× N boxes" string (from {@link formatUnitCount}),
 *     or `null` when omitted (same condition as `unit`).
 *
 * The `unit` / `suffix` pair is `null` when the breakdown would be
 * redundant or meaningless: INDIVIDUAL assets (qty always 1), QT assets
 * with `quantity` ≤ 1 or missing, and QT assets with `valuation: null`.
 */
export type AssetValueBreakdown = {
  total: string;
  unit: string | null;
  suffix: string | null;
};

/**
 * Renders an asset's value as a `{ total, unit, suffix }` breakdown.
 *
 * Used by UI surfaces that want to lead with the total (the number users
 * actually want when comparing inventory worth) while keeping the per-unit
 * price + count visible as supporting context.
 *
 * The breakdown decision matrix:
 *
 *   | Asset type   | quantity   | valuation | total          | unit       | suffix         |
 *   | ------------ | ---------- | --------- | -------------- | ---------- | -------------- |
 *   | INDIVIDUAL   | any        | any       | formatted      | `null`     | `null`         |
 *   | QT           | > 1        | non-null  | total formatted| unit price | "× N units"    |
 *   | QT           | > 1        | null      | "<zero string>"| `null`     | `null`         |
 *   | QT           | ≤ 1 / null | any       | formatted      | `null`     | `null`         |
 *
 * INDIVIDUAL assets get only `total` because qty is always 1 — a "× 1 unit"
 * suffix is redundant noise. QT assets with `quantity: 1` get the same
 * treatment for the same reason: there's nothing useful to break down.
 * QT assets with `valuation: null` show `"€0.00"` and no breakdown — the
 * caller's UI may choose to render `"-"` instead by checking `total` against
 * a zero-formatted string, but the helper itself is consistent.
 *
 * @param asset - The asset; reads `valuation`, `quantity`, `type`,
 *   `unitOfMeasure`. Type/unitOfMeasure are only consulted to label the
 *   suffix — passing them isn't required for INDIVIDUAL assets.
 * @param options - Workspace currency + locale to format the strings.
 * @returns The three breakdown pieces; `total` is always set, the other
 *   two are `null` when no useful breakdown applies.
 */
export function formatAssetValueWithBreakdown(
  asset: AssetForValue,
  options: FormatAssetValueOptions
): AssetValueBreakdown {
  const { currency, locale } = options;
  const total = getAssetTotalValue(asset);
  const totalFormatted = formatCurrency({ value: total, currency, locale });

  // QT assets with a real per-unit price and quantity > 1 get the full
  // breakdown. Everything else collapses to "just the total".
  const isQt = asset.type === "QUANTITY_TRACKED";
  const quantity = asset.quantity ?? 1;
  const hasValuation = asset.valuation != null;

  if (!isQt || quantity <= 1 || !hasValuation) {
    return { total: totalFormatted, unit: null, suffix: null };
  }

  // formatUnitCount returns null when not applicable; we've already gated
  // on type === QUANTITY_TRACKED and quantity > 0, so it should return a
  // string here, but the `?? null` keeps the type honest.
  const suffix = formatUnitCount(
    { type: asset.type as AssetType, unitOfMeasure: asset.unitOfMeasure },
    quantity
  );

  return {
    total: totalFormatted,
    unit: formatCurrency({
      value: asset.valuation ?? 0,
      currency,
      locale,
    }),
    suffix: suffix != null ? `× ${suffix}` : null,
  };
}
