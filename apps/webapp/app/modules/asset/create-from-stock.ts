/**
 * Create assets from stock: the rules both the dialog and the service read.
 *
 * Kept free of server imports so the route's dialog can use them.
 *
 * @see {@link file://./create-from-stock.server.ts}
 */

/** The most assets one "Create assets from stock" request may create. */
export const MAX_ASSETS_FROM_STOCK = 25;

/**
 * The names of `count` new assets: the typed name for one, the name with
 * " 1", " 2", ... appended for several.
 *
 * @param title - The name typed in the dialog
 * @param count - How many assets are made
 * @returns One name per asset, in order
 */
export function assetsFromStockTitles(title: string, count: number) {
  const name = title.trim();
  if (count === 1) return [name];
  return Array.from({ length: count }, (_, i) => `${name} ${i + 1}`);
}
