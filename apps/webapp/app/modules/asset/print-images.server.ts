/**
 * Asset Photos For Print
 *
 * Signs the lapsed asset photos a printable sheet is about to render, so every
 * row prints its photo instead of the placeholder. Used by the loaders of the
 * sheets that print photos: the booking checklist and the audit receipt.
 *
 * @see {@link file://./../../routes/api+/bookings.$bookingId.generate-pdf.tsx}
 * @see {@link file://./../../routes/api+/audits.$auditId.generate-pdf.tsx}
 * @see {@link file://./service.server.ts} `refreshExpiredAssetImages`, the
 *   persisting re-sign used by list and detail pages
 */

import { extractStoragePath } from "~/components/assets/asset-image/utils";
import { getSupabaseAdmin } from "~/integrations/supabase/client";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";

/** The storage bucket asset photos live in. */
const ASSETS_BUCKET = "assets";

/**
 * Lifetime of a print signature, in seconds. The URL only has to outlive the
 * preview and the print dialog, and it is never stored.
 */
const PRINT_SIGNED_URL_TTL_SECONDS = 60 * 60;

/** Paths sent to storage in one `createSignedUrls` call. */
const SIGN_CHUNK_SIZE = 500;

/** The image columns a printed row needs for its photo to be signed. */
type PrintableAssetImageRow = {
  id: string;
  mainImage: string | null;
  mainImageExpiration: Date | string | null;
  thumbnailImage?: string | null;
};

/**
 * Normalizes a storage path the way `createSignedUrl` does: storage keys never
 * start with a slash.
 *
 * @param path - A path from {@link extractStoragePath}.
 * @returns The path without a leading "/".
 */
function normalizeStoragePath(path: string): string {
  return path.startsWith("/") ? path.substring(1) : path;
}

/**
 * Extracts and normalizes the storage path of a photo URL.
 *
 * @param url - A stored photo URL, or null.
 * @returns The bucket-relative path, or null when there is none to sign.
 */
function storagePathOf(url: string | null | undefined): string | null {
  if (!url) return null;
  const path = extractStoragePath(url, ASSETS_BUCKET);
  return path ? normalizeStoragePath(path) : null;
}

/**
 * Signs one chunk of paths and records each signed URL by its path.
 *
 * Storage answers entry for entry in request order. A path storage refused
 * (a per-entry `error`, or no URL) is left out of `signedByPath`, so its row
 * keeps the URL it came with.
 *
 * @param paths - At most {@link SIGN_CHUNK_SIZE} distinct storage paths.
 * @param signedByPath - Map the signed URLs are written into.
 * @returns The paths storage refused, for logging.
 * @throws {StorageError} When the whole call fails.
 */
async function signChunk(
  paths: string[],
  signedByPath: Map<string, string>
): Promise<string[]> {
  const { data, error } = await getSupabaseAdmin()
    .storage.from(ASSETS_BUCKET)
    .createSignedUrls(paths, PRINT_SIGNED_URL_TTL_SECONDS);

  if (error) throw error;

  const refused: string[] = [];
  paths.forEach((path, index) => {
    const entry = data[index];
    if (entry && !entry.error && entry.signedUrl) {
      signedByPath.set(path, entry.signedUrl);
    } else {
      refused.push(path);
    }
  });
  return refused;
}

/**
 * Signs the lapsed photos of the rows a printable sheet renders.
 *
 * A row whose `mainImageExpiration` has passed gets a fresh signed URL for its
 * main image and, when it has one, its thumbnail. Fresh rows are returned as
 * they came in.
 *
 * Print does not use `refreshExpiredAssetImages`, for three reasons:
 * - **Read-only.** Opening a preview must not change the assets it shows.
 *   `refreshExpiredAssetImages` writes the new URL back, and that write bumps
 *   `Asset.updatedAt` on every asset it re-signs.
 * - **Every row prints.** A sheet has no "next load" to repair the rest, so
 *   there is no row cap. Signing goes through storage's bulk endpoint, one call
 *   per {@link SIGN_CHUNK_SIZE} distinct paths with the chunks in parallel, so a
 *   large sheet costs one or two round trips rather than one per photo.
 * - **Short-lived.** The URL is needed only for the print, so it lives one
 *   hour and is never stored.
 *
 * Never throws. When storage fails, as a whole or for single paths, the error
 * is logged and the affected rows are returned unchanged; the sheet then prints
 * its placeholder for those photos.
 *
 * @param assets - The sheet's rows, already loaded scoped to the workspace.
 *   A repeated asset (one per booking slice) is signed once.
 * @param options.organizationId - The workspace, for the error log only.
 * @returns The rows in input order, index for index, with signed URLs merged
 *   into `mainImage` and `thumbnailImage`.
 */
export async function signAssetPhotosForPrint<T extends PrintableAssetImageRow>(
  assets: T[],
  { organizationId }: { organizationId: string }
): Promise<T[]> {
  const now = Date.now();
  const lapsed = (row: T) =>
    Boolean(
      row.mainImage &&
        row.mainImageExpiration &&
        new Date(row.mainImageExpiration).getTime() < now
    );

  // Every distinct path any lapsed row needs, main image and thumbnail alike.
  const paths = new Set<string>();
  for (const row of assets) {
    if (!lapsed(row)) continue;
    const mainPath = storagePathOf(row.mainImage);
    if (!mainPath) continue;
    paths.add(mainPath);
    const thumbnailPath = storagePathOf(row.thumbnailImage);
    if (thumbnailPath) paths.add(thumbnailPath);
  }

  if (paths.size === 0) return assets;

  const allPaths = [...paths];
  const chunks: string[][] = [];
  for (let start = 0; start < allPaths.length; start += SIGN_CHUNK_SIZE) {
    chunks.push(allPaths.slice(start, start + SIGN_CHUNK_SIZE));
  }

  const signedByPath = new Map<string, string>();
  const results = await Promise.allSettled(
    chunks.map((chunk) => signChunk(chunk, signedByPath))
  );

  const failedChunks = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason as unknown] : []
  );
  const refusedPaths = results.flatMap((result) =>
    result.status === "fulfilled" ? result.value : []
  );
  if (failedChunks.length > 0 || refusedPaths.length > 0) {
    Logger.error(
      new ShelfError({
        cause: failedChunks[0] ?? null,
        message:
          "Some asset photos could not be signed for print. They print as placeholders.",
        additionalData: {
          organizationId,
          failedChunks: failedChunks.length,
          refusedPaths: refusedPaths.length,
          totalPaths: allPaths.length,
        },
        label: "Assets",
        // A whole-call failure is a storage outage worth an alert; single
        // refused paths are usually photos deleted from storage.
        shouldBeCaptured: failedChunks.length > 0,
      })
    );
  }

  if (signedByPath.size === 0) return assets;

  return assets.map((row) => {
    if (!lapsed(row)) return row;
    const mainPath = storagePathOf(row.mainImage);
    const signedMain = mainPath ? signedByPath.get(mainPath) : undefined;
    if (!signedMain) return row;

    const thumbnailPath = storagePathOf(row.thumbnailImage);
    const signedThumbnail = thumbnailPath
      ? signedByPath.get(thumbnailPath)
      : undefined;

    return {
      ...row,
      mainImage: signedMain,
      ...(signedThumbnail ? { thumbnailImage: signedThumbnail } : {}),
    };
  });
}
