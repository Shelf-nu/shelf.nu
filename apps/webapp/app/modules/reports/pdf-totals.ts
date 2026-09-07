/**
 * Quantity-aware value math for report PDF exports.
 *
 * Report rows carry a PER-UNIT `valuation` plus the quantity that the
 * surface's own semantics dictate (workspace stock for inventory rows,
 * `Custody.quantity` for custody rows — see
 * `.claude/rules/quantity-semantics-per-surface.md`). A PDF total must
 * multiply the two, exactly like the on-screen KPIs, or the file handed to
 * an insurer disagrees with the page it was exported from.
 *
 * @see {@link file://../../routes/api+/reports.$reportId.generate-pdf.tsx}
 */

/** The minimal row shape the PDF totals need. */
export interface QuantityAwareValueRow {
  /** Per-unit valuation; `null` when the asset has no value set. */
  valuation: number | null;
  /** Unit count for this row's surface; `null` means a single unit. */
  quantity: number | null;
}

/**
 * Sums `valuation × quantity` across rows.
 *
 * `null` valuation counts as zero; `null` quantity counts as one (the
 * Prisma shape for INDIVIDUAL assets).
 *
 * @param rows - Report rows carrying per-unit valuation and unit count.
 * @returns The quantity-aware total value.
 */
export function sumQuantityAwareValue(
  rows: readonly QuantityAwareValueRow[]
): number {
  return rows.reduce(
    (sum, row) => sum + (row.valuation ?? 0) * (row.quantity ?? 1),
    0
  );
}
