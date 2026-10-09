/**
 * In-memory stand-in for where asset photos live: the private `assets` storage
 * bucket and the image URLs on `Asset` rows. It answers the two raw queries of
 * `removeImageFilesOfDeletedAssets` and records the bucket's `remove` calls, so
 * a test describes a scenario (who uploaded what, which asset still shows
 * which file) and asserts which files are gone afterwards.
 *
 * Use one instance per test file, reset in `beforeEach`:
 *
 * @example
 * vi.mock("~/integrations/supabase/client", async () => ({
 *   getSupabaseAdmin: (await import("@mocks/asset-image-storage"))
 *     .assetImageStorage.getSupabaseAdmin,
 * }));
 * // and route the db mock's `$queryRaw` to `assetImageStorage.queryRaw`
 *
 * @see {@link file://../../app/modules/asset/image-files.server.ts}
 */
import { vi } from "vitest";

/** The `Asset` image columns the reference check reads. */
type AssetImageRow = {
  mainImage: string | null;
  thumbnailImage: string | null;
};

const SIGNED_URL_PREFIX =
  "https://supabase.example.com/storage/v1/object/sign/assets/";

/**
 * Signed URL of an object in the `assets` bucket, shaped like the ones
 * `createSignedUrl` stores on `Asset.mainImage` / `Asset.thumbnailImage`.
 */
export function signedAssetUrl(path: string) {
  return `${SIGNED_URL_PREFIX}${path}?token=test-token`;
}

/** The folder asset id of a stored URL, as the SQL `split_part` reads it. */
function folderAssetIdOfUrl(url: string | null) {
  return url?.split("/assets/")[1]?.split("/")[1];
}

/** The id array a raw query was given, the only array parameter they take. */
function idsParam(values: unknown[]): string[] {
  const ids = values.find((value) => Array.isArray(value));
  if (!ids) {
    throw new Error("expected an id array parameter");
  }
  return ids as string[];
}

function createAssetImageStorage() {
  /** Object paths currently in the bucket. */
  const files = new Set<string>();
  /** Image URLs of the asset rows that still exist. */
  let remainingAssets: AssetImageRow[] = [];

  const remove = vi.fn(async (paths: string[]) => {
    paths.forEach((path) => files.delete(path));
    return { data: paths.map((name) => ({ name })), error: null };
  });

  /**
   * Answers the lookups by the SQL text, so the order of the two queries is
   * not part of what a test asserts.
   */
  const queryRaw = vi.fn(
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join("?");

      if (sql.includes("FROM storage.objects")) {
        const assetIds = idsParam(values);
        return [...files]
          .filter((path) => assetIds.includes(path.split("/")[1]))
          .map((name) => ({ name }));
      }

      if (sql.includes('FROM "Asset"')) {
        const folderIds = idsParam(values);
        return remainingAssets.filter((asset) =>
          [asset.mainImage, asset.thumbnailImage].some((url) =>
            folderIds.includes(folderAssetIdOfUrl(url) ?? "")
          )
        );
      }

      throw new Error(`unexpected raw query: ${sql}`);
    }
  );

  const from = vi.fn((bucket: string) => {
    if (bucket !== "assets") {
      throw new Error(`unexpected bucket: ${bucket}`);
    }
    return { remove };
  });

  return {
    queryRaw,
    remove,
    /** Stand-in for `getSupabaseAdmin`, exposing only `storage.from`. */
    getSupabaseAdmin: () => ({ storage: { from } }),

    /** Empties the bucket and the asset rows and clears recorded calls. */
    reset() {
      files.clear();
      remainingAssets = [];
      remove.mockClear();
      queryRaw.mockClear();
      from.mockClear();
    },

    /** Puts objects in the bucket, at `<uploaderUserId>/<assetId>/<file>`. */
    upload(...paths: string[]) {
      paths.forEach((path) => files.add(path));
    },

    /** Sets the asset rows that remain after the delete. */
    setRemainingAssets(rows: AssetImageRow[]) {
      remainingAssets = rows;
    },

    /** Object paths still in the bucket, sorted. */
    storedFiles() {
      return [...files].sort();
    },
  };
}

/** The shared fake; import it in the test and in the mock factories. */
export const assetImageStorage = createAssetImageStorage();

/**
 * Lets un-awaited cleanup finish. The fake answers with resolved promises,
 * so one macrotask is enough for every chained await before it.
 */
export function settleBackgroundWork() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
