/**
 * Consumption Log Constants
 *
 * Values shared between the code that writes `ConsumptionLog` rows and the
 * code that reads them back into sentences. Kept free of imports so any layer,
 * including the pure email copy builders, can depend on it.
 *
 * @see {@link file://../asset/service.server.ts} - writes the asset-edit note
 * @see {@link file://../../emails/low-stock-copy.ts} - reads it back
 */

/**
 * The note on the ADJUSTMENT row the asset edit form writes when a user changes
 * the quantity field. Readers match on it to say "on the asset edit page"
 * instead of quoting it, so writer and reader must use this one value.
 */
export const ASSET_EDIT_ADJUSTMENT_NOTE = "Quantity adjusted via asset edit";
