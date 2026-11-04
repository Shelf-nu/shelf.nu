/**
 * Audit unit counts shared by the webapp and the companion app.
 *
 * When an audit counts a quantity-tracked asset, both apps bound the count the
 * same way and decide the same way what the count prompt can promise. The
 * server enforces the bound; the prompts only follow it.
 *
 * @see apps/webapp/app/modules/audit/quantity.ts
 * @see apps/webapp/app/components/audit/audit-count-flow.ts
 * @see apps/companion/lib/audit-scan-queue.ts
 */

/**
 * Largest count stored for one audit row: the Postgres INTEGER ceiling. A
 * count may go past the expected units (a surplus), so this is the only upper
 * bound.
 */
export const MAX_AUDIT_COUNT = 2_147_483_647;

/** What the count prompt can promise about an asset's units. */
export type AuditCountExpectation = "expected" | "none-expected" | "unlisted";

/**
 * What the count prompt can promise about the units:
 * - `"expected"`: an asset on the audit's list with units expected, which the
 *   prompt prefills and lets the auditor confirm ("All here (14)");
 * - `"none-expected"`: an asset on the list with nothing expected, so there is
 *   nothing to confirm;
 * - `"unlisted"`: an asset not on the audit's list.
 *
 * @param prompt - whether the asset is on the list, and its expected units
 */
export function countExpectation(prompt: {
  isExpected: boolean;
  expectedQuantity: number;
}): AuditCountExpectation {
  if (!prompt.isExpected) return "unlisted";
  return prompt.expectedQuantity > 0 ? "expected" : "none-expected";
}
