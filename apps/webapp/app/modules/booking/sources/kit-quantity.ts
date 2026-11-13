/**
 * Kit quantity change on a converted KIT source row.
 *
 * A kit-driven slice of a converted group carries one KIT row. When the kit's
 * quantity changes, that row follows: an increase becomes new pending units, a
 * decrease removes pending units first, then released units, and never goes
 * below the units physically out.
 *
 * @see {@link file://./types.ts}
 * @see superpowers/2026-11-10-booking-source-locations-design.md section 6.4
 */
import { decreaseSliceQuantity } from "@shelf/quantity-control";
import type { SourceRowState } from "@shelf/quantity-control";

/**
 * Resizes a KIT row to a new quantity.
 *
 * @param row - The KIT row of a converted kit slice
 * @param newQuantity - The new planned quantity, a non-negative integer
 * @returns The resized row, or `{ ok: false, out }` when `newQuantity` is below
 *   the units out (`out` is the floor the caller reports)
 * @throws {Error} When the row is not a KIT row or `newQuantity` is not a
 *   non-negative integer
 */
export function resizeKitRow(
  row: SourceRowState,
  newQuantity: number
): { ok: true; row: SourceRowState } | { ok: false; out: number } {
  if (row.kind !== "KIT") {
    throw new Error(`resizeKitRow needs a KIT row (got ${row.kind})`);
  }
  if (!Number.isInteger(newQuantity) || newQuantity < 0) {
    throw new Error(
      `newQuantity must be a non-negative integer (got ${newQuantity})`
    );
  }
  if (newQuantity < row.outQuantity) {
    return { ok: false, out: row.outQuantity };
  }
  if (newQuantity >= row.quantity) {
    return { ok: true, row: { ...row, quantity: newQuantity } };
  }
  // Decrease: pending first, then released, never below out (checked above).
  const [next] = decreaseSliceQuantity([row], row.quantity - newQuantity);
  return { ok: true, row: next };
}
