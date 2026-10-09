/**
 * Asset Image Files
 *
 * Removes the stored image files of deleted assets from the private `assets`
 * storage bucket. An asset's photo and thumbnail are stored at
 * `<uploaderUserId>/<assetId>/main-image-<unix>[.ext]` (see
 * `updateAssetMainImage`), so one asset can have files in several folders: one
 * per user who ever uploaded its photo. The folder is named after the
 * uploader, not after the person deleting, so the files are found by the
 * asset id segment of the path.
 *
 * A file is kept while any remaining asset's `mainImage` or `thumbnailImage`
 * still points at it: some assets show a photo stored in another asset's
 * folder, and removing it would break that asset's image.
 *
 * Every asset delete path (web single delete, bulk delete, the companion's
 * delete) runs this after its transaction commits.
 *
 * @see {@link file://./service.server.ts} `deleteAsset`, `bulkDeleteAssets`
 * @see {@link file://./service.server.ts} `deleteOtherImages`, which removes a
 *   replaced photo while keeping the current one
 */

import type { Asset } from "@prisma/client";
import { extractStoragePath } from "~/components/assets/asset-image/utils";
import { db } from "~/database/db.server";
import { getSupabaseAdmin } from "~/integrations/supabase/client";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";

const label: ErrorLabel = "Assets";

/** The private storage bucket asset photos live in. */
const ASSETS_BUCKET = "assets";

/** The most object paths the storage API removes in one request. */
const MAX_FILES_PER_REMOVE = 1000;

/**
 * Removes every stored image file of the given deleted assets, whoever
 * uploaded it, except files a remaining asset still shows.
 *
 * Call this only after the asset rows are deleted: a file is protected by the
 * assets that still exist, so an asset that is still in the database protects
 * its own files. Best effort: a failed lookup or storage request is logged and
 * never rejects, because the delete has already happened and a stale file can
 * be cleaned up later.
 *
 * Costs one scan of the bucket's object list and, when any files are found,
 * one scan of the asset table, whatever the number of assets. Callers run it
 * without awaiting so the delete response does not wait for it.
 *
 * @param assetIds - Ids of assets whose rows were deleted
 */
export async function removeImageFilesOfDeletedAssets(
  assetIds: Asset["id"][]
): Promise<void> {
  const uniqueAssetIds = [...new Set(assetIds)];
  if (uniqueAssetIds.length === 0) {
    return;
  }

  let paths: string[];
  try {
    paths = await findUnreferencedImageFiles(uniqueAssetIds);
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause,
        message: "Failed to look up the image files of deleted assets",
        additionalData: { assetIds: uniqueAssetIds },
        label,
      })
    );
    return;
  }

  for (let i = 0; i < paths.length; i += MAX_FILES_PER_REMOVE) {
    const chunk = paths.slice(i, i + MAX_FILES_PER_REMOVE);

    try {
      const { error } = await getSupabaseAdmin()
        .storage.from(ASSETS_BUCKET)
        .remove(chunk);

      if (error) {
        throw error;
      }
    } catch (cause) {
      Logger.error(
        new ShelfError({
          cause,
          message: "Failed to remove image files of deleted assets",
          // The asset ids trace the files without logging the object keys.
          additionalData: { assetIds: assetIdsOfPaths(chunk) },
          label,
        })
      );
    }
  }
}

/**
 * Lists the stored files in the folders of the given assets that no remaining
 * asset points at.
 *
 * @param assetIds - Ids of deleted assets, without duplicates
 * @returns Object paths in the `assets` bucket, safe to remove
 * @throws When either database read fails
 */
async function findUnreferencedImageFiles(
  assetIds: Asset["id"][]
): Promise<string[]> {
  // Supabase records every stored object in `storage.objects`. The path's
  // second segment is the asset id; the first is whoever uploaded the file.
  const storedFiles = await db.$queryRaw<{ name: string }[]>`
    SELECT name
    FROM storage.objects
    WHERE bucket_id = ${ASSETS_BUCKET}
      AND split_part(name, '/', 2) IN (SELECT unnest(${assetIds}::text[]))
  `;

  if (storedFiles.length === 0) {
    return [];
  }

  // Assets whose photo or thumbnail URL points into one of these folders.
  // The URL path after `/assets/` is the object path, so its second segment
  // is the folder's asset id, the same as above.
  const folderIds = assetIdsOfPaths(storedFiles.map((file) => file.name));
  const referencingAssets = await db.$queryRaw<
    { mainImage: string | null; thumbnailImage: string | null }[]
  >`
    SELECT "mainImage", "thumbnailImage"
    FROM "Asset"
    WHERE split_part(split_part("mainImage", '/assets/', 2), '/', 2)
            IN (SELECT unnest(${folderIds}::text[]))
       OR split_part(split_part("thumbnailImage", '/assets/', 2), '/', 2)
            IN (SELECT unnest(${folderIds}::text[]))
  `;

  const referencedPaths = new Set(
    referencingAssets
      .flatMap((asset) => [asset.mainImage, asset.thumbnailImage])
      .filter((url): url is string => !!url)
      .map((url) => extractStoragePath(url, ASSETS_BUCKET))
  );

  return storedFiles
    .map((file) => file.name)
    .filter((path) => !referencedPaths.has(path));
}

/**
 * Collects the asset ids (the second path segment) of object paths in the
 * `assets` bucket.
 *
 * @param paths - Object paths shaped `<uploaderUserId>/<assetId>/<file>`
 * @returns The distinct asset ids, as an array so it serializes into logs
 */
function assetIdsOfPaths(paths: string[]): string[] {
  return [...new Set(paths.map((path) => path.split("/")[1]))];
}
