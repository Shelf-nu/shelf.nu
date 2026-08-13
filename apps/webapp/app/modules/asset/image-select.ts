/**
 * Shared Prisma selection for asset image inheritance.
 *
 * Any query feeding a surface that renders `<AssetImage>` must spread this, or
 * that surface silently drops assets which inherit their image from their model
 * down to the placeholder — the inconsistency this feature exists to remove.
 *
 * `AssetImageProps` requires the `assetModel` field, so a missing spread shows
 * up as a typecheck failure rather than as a wrong-looking page.
 *
 * Kept in its own module (not in `image-resolution.ts`) so the pure resolver
 * stays free of anything Prisma-shaped and can be imported by React components.
 *
 * @see {@link file://./image-resolution.ts}
 */

/**
 * Spread into an asset `select` alongside `mainImage` / `thumbnailImage`.
 *
 * Two columns off a `LEFT JOIN`-able to-one relation — Prisma batches it into a
 * single `WHERE id IN (...)` round trip per page, and the resulting URLs are
 * public and shared, so N assets of one model render from one cached object.
 */
export const ASSET_MODEL_IMAGE_SELECT = {
  assetModel: { select: { image: true, thumbnailImage: true } },
} as const;
