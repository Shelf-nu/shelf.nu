/**
 * Asset import number formatting
 *
 * Shared by the import screens, the floating progress card and the assets
 * list notice so every count reads the same way ("1 asset", "5,000 assets").
 * Client-safe: no server imports.
 */

/**
 * Formats a count with thousands separators.
 *
 * @param count - Any non-negative integer
 * @returns The count as "5,000"
 */
export function formatCount(count: number): string {
  return count.toLocaleString("en-US");
}

/**
 * Formats a count followed by "asset" or "assets".
 *
 * @param count - Number of assets
 * @returns "1 asset" or "5,000 assets"
 */
export function formatAssetCount(count: number): string {
  return `${formatCount(count)} ${count === 1 ? "asset" : "assets"}`;
}

/**
 * Formats a count followed by "row" or "rows".
 *
 * @param count - Number of rows
 * @returns "1 row" or "12 rows"
 */
export function formatRowCount(count: number): string {
  return `${formatCount(count)} ${count === 1 ? "row" : "rows"}`;
}
