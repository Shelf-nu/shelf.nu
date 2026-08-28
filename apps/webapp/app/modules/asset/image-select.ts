/**
 * Shared Prisma selection for asset image inheritance.
 *
 * Any query feeding a surface that renders `<AssetImage>` must spread this, or
 * that surface silently drops assets which inherit their image from their model
 * down to the placeholder — the inconsistency this feature exists to remove.
 *
 * `AssetImageProps` requires `assetModel`, so a missing spread normally shows up
 * as a typecheck failure rather than as a wrong-looking page. That guarantee is
 * only as strong as the path between the loader and the render, and exactly two
 * patterns dissolve it:
 *
 * 1. **A cast on the row.** `as unknown as SomeRowType` asserts a shape rather
 *    than checking one, so a row missing the relation passes. Where a cast is
 *    genuinely needed (serialized loader data cannot satisfy a Prisma-derived
 *    type structurally), constrain its INPUT — see `asEnrichedAssets` in
 *    `~/components/booking/booking-assets-column`, whose
 *    `T extends AssetWithResolvableImage` is what makes the loader prove it
 *    carries the relation before the cast happens.
 * 2. **An optional `assetModel?:` on a component's own prop type, plus
 *    `assetModel: item.assetModel ?? null` at the call site.** Together these
 *    make "no model" and "loader forgot the relation" indistinguishable. Declare
 *    it required and pass it straight through; `null` is a real answer and
 *    survives on its own.
 *
 * Neither is visible at runtime: nothing throws, the page just shows the
 * placeholder for every asset that inherits its image.
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
