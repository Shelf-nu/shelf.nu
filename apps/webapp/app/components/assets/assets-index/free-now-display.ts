/**
 * `Free now` cell text.
 *
 * The free count alone is not an answer: 4 is a crisis out of 5 and nothing
 * out of 400, and the unit says whether it is 4 boxes or 4 kilos. Total
 * quantity and Unit of measure start hidden, so the cell carries both:
 * "14 of 20 pcs". The column still sorts and filters on the free count, and
 * the export keeps it a bare number.
 *
 * @see {@link file://./advanced-asset-columns.tsx} - the cell that renders this.
 */

/**
 * Formats a quantity pool's free count with what it is out of.
 *
 * @param args.available - Units free right now
 * @param args.total - Units owned; without it the free count stands alone
 * @param args.unitOfMeasure - The pool's unit, when it has one
 * @returns "14 of 20 pcs", "14 of 20", or "14"
 */
export function resolveFreeNowText({
  available,
  total,
  unitOfMeasure,
}: {
  available: number;
  total: number | null | undefined;
  unitOfMeasure: string | null | undefined;
}): string {
  if (total == null) return `${available}`;
  const unit = unitOfMeasure?.trim() ? ` ${unitOfMeasure.trim()}` : "";
  return `${available} of ${total}${unit}`;
}
