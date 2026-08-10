-- AssetModel cover images move to the public `files` bucket.
-- `image` was never written by any code path (all NULL in production), so it is
-- repurposed in place from a signed URL to a public URL with no data migration.
-- `imageExpiration` is meaningless without signed URLs and is likewise all NULL.
-- Both operations are catalog-only in Postgres: no table rewrite, no long lock.
ALTER TABLE "AssetModel" ADD COLUMN "thumbnailImage" TEXT;
ALTER TABLE "AssetModel" DROP COLUMN "imageExpiration";
