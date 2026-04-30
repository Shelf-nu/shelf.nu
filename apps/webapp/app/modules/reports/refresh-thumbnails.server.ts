/**
 * Report Thumbnail URL Refresher
 *
 * Reports return rows that contain `thumbnailImage` — Supabase signed URLs
 * with a JWT that expires after 72 hours. If the report runs against assets
 * whose thumbnail URLs have expired, the client receives stale URLs that
 * 401 in the browser, leaving users with broken-image icons.
 *
 * This helper bridges report rows back to the underlying asset records and
 * delegates to {@link refreshExpiredAssetImages} to do the actual refresh.
 * That existing helper:
 *   - Skips assets whose `mainImageExpiration` is still in the future
 *     (cheap when URLs are fresh — no Supabase calls in the hot path).
 *   - Batches Supabase signing requests with a `BATCH_SIZE` of 10.
 *   - Persists the new URLs to the database, so subsequent loads (any
 *     view that reads the asset, not just reports) see the fresh URLs.
 *   - Falls back gracefully on per-asset failures.
 *
 * @see {@link file://./../asset/service.server.ts} for `refreshExpiredAssetImages`
 * @see {@link file://./helpers.server.ts} for the report loaders that call this
 */

import { db } from "~/database/db.server";
import { refreshExpiredAssetImages } from "../asset/service.server";

/**
 * Re-sign expired Supabase thumbnail URLs on a list of report rows in place
 * (returns a new array; never mutates input).
 *
 * Each row must carry the `assetId` it came from so we can look the asset
 * up in the database and persist the refresh.
 *
 * @param rows - Report rows with `assetId` and `thumbnailImage`
 * @param organizationId - The current workspace; scopes the asset lookup
 * @returns The same rows, with `thumbnailImage` swapped for a fresh signed
 *          URL when the original was expired. Rows whose underlying asset
 *          has no main image, no recorded expiration, or wasn't found are
 *          returned unchanged.
 */
export async function refreshExpiredReportThumbnails<
  T extends { assetId: string; thumbnailImage: string | null },
>(rows: T[], organizationId: string): Promise<T[]> {
  if (rows.length === 0) return rows;

  // Only consider rows that actually have a thumbnail to refresh.
  const candidateAssetIds = Array.from(
    new Set(rows.filter((r) => r.thumbnailImage).map((r) => r.assetId))
  );

  if (candidateAssetIds.length === 0) return rows;

  // Pull the fields refreshExpiredAssetImages needs to (a) decide whether
  // to refresh and (b) actually do the refresh. Scoped to the org to keep
  // the existing tenant boundary intact.
  const assets = await db.asset.findMany({
    where: { id: { in: candidateAssetIds }, organizationId },
    select: {
      id: true,
      organizationId: true,
      mainImage: true,
      mainImageExpiration: true,
      thumbnailImage: true,
    },
  });

  if (assets.length === 0) return rows;

  // refreshExpiredAssetImages internally filters to only-expired assets,
  // batches Supabase calls, persists the new URLs, and returns the same
  // shape with `mainImage` / `thumbnailImage` updated where applicable.
  const refreshed = await refreshExpiredAssetImages(assets);

  // Build assetId -> fresh thumbnail URL map for any asset whose thumbnail
  // was actually replaced. Assets that didn't need refresh (or whose
  // refresh failed) end up with the same thumbnail — no entry added.
  const freshThumbnailByAssetId = new Map<string, string>();
  for (const asset of refreshed) {
    const original = assets.find((a) => a.id === asset.id);
    if (
      asset.thumbnailImage &&
      original &&
      asset.thumbnailImage !== original.thumbnailImage
    ) {
      freshThumbnailByAssetId.set(asset.id, asset.thumbnailImage);
    }
  }

  if (freshThumbnailByAssetId.size === 0) return rows;

  return rows.map((row) => {
    const fresh = freshThumbnailByAssetId.get(row.assetId);
    if (!fresh) return row;
    return { ...row, thumbnailImage: fresh };
  });
}
