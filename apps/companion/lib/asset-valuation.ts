/**
 * Asset valuation, between the number the server stores and the text the edit
 * form holds.
 *
 * Zero is a real answer. The webapp's schema maps a blank field to `null` and
 * passes every number through untouched, including `0` and negatives, so an
 * operator can deliberately record an asset as worth nothing. "No answer" is
 * `null` and nothing else.
 *
 * Both directions live here because three places need the same rule, and a
 * disagreement between them is silent: a stored `0` that does not reach the
 * input comes back as a blank field, which the save then stores as `null` and
 * the valuation is gone without anyone touching it.
 *
 * @see {@link file://../hooks/use-edit-asset-form.ts} loads the asset
 * @see {@link file://../app/(tabs)/assets/edit.tsx} builds the save payload
 * @see {@link file://../hooks/use-form-validation.ts} detects unsaved edits
 */

/**
 * The string the edit form's valuation input shows for a stored valuation.
 *
 * @param valuation - What the server has, `null` when the asset has none
 * @returns The input's text. Empty only when there is no valuation at all.
 */
export function valuationToInput(valuation: number | null | undefined): string {
  return valuation == null ? "" : String(valuation);
}

/**
 * The valuation to store for what the operator typed.
 *
 * Emptiness is decided before parsing, so a field holding only spaces counts
 * as no answer rather than as zero. Text that is not a number at all is also
 * no answer: it cannot be stored, and `NaN` must never reach the payload.
 *
 * @param input - The input's current text
 * @returns The number to store, or `null` for no valuation
 */
export function valuationFromInput(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = parseFloat(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}
