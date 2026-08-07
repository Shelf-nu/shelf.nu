import type { AssetModel, Organization, Prisma, User } from "@prisma/client";
import { extractStoragePath } from "~/components/assets/asset-image/utils";
import { db } from "~/database/db.server";
import { ASSET_MAX_IMAGE_UPLOAD_SIZE } from "~/utils/constants";
import { dateTimeInUnix } from "~/utils/date-time-in-unix";
import type { ErrorLabel } from "~/utils/error";
import {
  ShelfError,
  isLikeShelfError,
  maybeUniqueConstraintViolation,
} from "~/utils/error";
import { ALL_SELECTED_KEY } from "~/utils/list";
import { Logger } from "~/utils/logger";
import { threeDaysFromNow } from "~/utils/one-week-from-now";
import {
  createSignedUrl,
  getThumbnailStoragePath,
  parseFileFormData,
} from "~/utils/storage.server";
import type { CreateAssetFromContentImportPayload } from "../asset/types";

const label: ErrorLabel = "Asset Model";

/**
 * Storage bucket that holds asset-model cover images.
 *
 * Deliberately the SAME bucket assets use (not a dedicated `asset-models`
 * bucket): an asset that inherits its model's cover image stores the model's
 * URL in `Asset.mainImage`, and every existing re-sign / thumbnail path
 * (`refreshExpiredAssetImages`, `api+/asset.refresh-main-image`,
 * `api+/asset.generate-thumbnail`) resolves that URL with
 * `extractStoragePath(url, "assets")`. A separate bucket would make those
 * paths unresolvable and every inherited image would break after 72h.
 */
const ASSET_MODEL_IMAGE_BUCKET = "assets";

/**
 * Path segment that marks a storage object as belonging to an asset model
 * rather than to a single asset. Asset-model images live at
 * `<userId>/asset-models/<assetModelId>/image-<unix>`, while per-asset images
 * live at `<userId>/<assetId>/main-image-<unix>` — so the segment is what
 * tells "this asset is displaying its model's shared image" apart from "this
 * asset has its own uploaded image".
 */
const ASSET_MODEL_IMAGE_PATH_SEGMENT = "asset-models";

/**
 * Whether a stored image URL points at an asset model's shared cover image.
 *
 * Used as the ownership test before overwriting or clearing an asset's
 * `mainImage`: an asset whose image lives under the model's storage folder is
 * *inheriting* it and may be re-stamped, whereas an asset with its own
 * uploaded image must never be touched.
 *
 * Matches on the storage PATH, not the URL string, because signed URLs are
 * re-signed per asset over time (`refreshExpiredAssetImages` writes a fresh
 * token onto the asset row) — the path is the only stable part.
 *
 * @param imageUrl - The asset's stored `mainImage` URL (or null)
 * @param assetModelId - Optional: require the image to belong to THIS model
 * @returns true when the URL resolves to an asset-model image path
 */
export function isAssetModelImageUrl(
  imageUrl: string | null | undefined,
  assetModelId?: AssetModel["id"]
): boolean {
  if (!imageUrl) {
    return false;
  }

  const path = extractStoragePath(imageUrl, ASSET_MODEL_IMAGE_BUCKET);
  if (!path) {
    return false;
  }

  return assetModelId
    ? path.includes(`/${ASSET_MODEL_IMAGE_PATH_SEGMENT}/${assetModelId}/`)
    : path.includes(`/${ASSET_MODEL_IMAGE_PATH_SEGMENT}/`);
}

/**
 * Creates a new asset model (template/grouping entity for assets).
 * Asset models provide default values when creating new assets from them.
 */
export async function createAssetModel({
  name,
  description,
  defaultCategoryId,
  defaultValuation,
  userId,
  organizationId,
}: Pick<AssetModel, "name" | "organizationId"> & {
  description?: string | null;
  defaultCategoryId?: string | null;
  defaultValuation?: number | null;
  userId: User["id"];
}) {
  try {
    return await db.assetModel.create({
      data: {
        name: name.trim(),
        description,
        defaultValuation,
        defaultCategory: defaultCategoryId
          ? { connect: { id: defaultCategoryId } }
          : undefined,
        createdBy: {
          connect: { id: userId },
        },
        organization: {
          connect: { id: organizationId },
        },
      },
    });
  } catch (cause) {
    throw maybeUniqueConstraintViolation(cause, "AssetModel", {
      additionalData: { userId, organizationId },
    });
  }
}

/**
 * Fetches a paginated list of asset models for the given organization.
 * Includes the count of assets associated with each model.
 */
export async function getAssetModels(params: {
  organizationId: Organization["id"];
  /** Page number. Starts at 1 */
  page?: number;
  /** Items to be loaded per page */
  perPage?: number;
  search?: string | null;
}) {
  const { organizationId, page = 1, perPage = 8, search } = params;

  try {
    const skip = page > 1 ? (page - 1) * perPage : 0;
    const take = perPage >= 1 ? perPage : 8;

    const where: Prisma.AssetModelWhereInput = { organizationId };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    const [assetModels, totalAssetModels] = await Promise.all([
      db.assetModel.findMany({
        skip,
        take,
        where,
        orderBy: { updatedAt: "desc" },
        include: {
          _count: {
            select: { assets: true },
          },
          defaultCategory: {
            select: { id: true, name: true, color: true },
          },
        },
      }),

      db.assetModel.count({ where }),
    ]);

    return { assetModels, totalAssetModels };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while fetching the asset models",
      additionalData: { ...params },
      label,
    });
  }
}

/**
 * Fetches a single asset model by ID, scoped to the given organization.
 */
export async function getAssetModel({
  id,
  organizationId,
}: Pick<AssetModel, "id" | "organizationId">) {
  try {
    return await db.assetModel.findFirstOrThrow({
      where: { id, organizationId },
      include: {
        defaultCategory: {
          select: { id: true, name: true, color: true },
        },
      },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "Asset model not found",
      message:
        "The asset model you are trying to access does not exist or you do not have permission to access it.",
      additionalData: { id, organizationId },
      label,
    });
  }
}

/**
 * Updates an existing asset model's fields.
 */
export async function updateAssetModel({
  id,
  organizationId,
  name,
  description,
  defaultCategoryId,
  defaultValuation,
}: Pick<AssetModel, "id" | "organizationId"> & {
  name?: string;
  description?: string | null;
  defaultCategoryId?: string | null;
  defaultValuation?: number | null;
}) {
  try {
    return await db.assetModel.update({
      where: { id, organizationId },
      data: {
        name: name?.trim(),
        description,
        defaultValuation,
        defaultCategory: defaultCategoryId
          ? { connect: { id: defaultCategoryId } }
          : defaultCategoryId === null
          ? { disconnect: true }
          : undefined,
      },
    });
  } catch (cause) {
    throw maybeUniqueConstraintViolation(cause, "AssetModel", {
      additionalData: { id, organizationId, name },
    });
  }
}

/** The image fields an inheriting asset copies from its model. */
type InheritableAssetModelImage = {
  /** Signed URL of the model's full-size cover image */
  image: string;
  /** When that signed URL expires */
  imageExpiration: Date | null;
  /** Signed URL of the model's shared 108px thumbnail, when resolvable */
  thumbnailImage: string | null;
};

/**
 * Reads the cover image an asset should inherit when it is linked to a model
 * and has no image of its own.
 *
 * Narrow, org-scoped read (two columns) so the create/update asset paths don't
 * pull a whole `AssetModel` row just to resolve an image.
 *
 * The thumbnail isn't a column on `AssetModel` — it doesn't need to be. Its
 * storage path is derived from the image path by the same
 * {@link getThumbnailStoragePath} rule the upload wrote it with, so it is
 * re-signed on demand here. Stamping it means an inheriting asset renders
 * immediately at list sizes instead of firing a `generate-thumbnail` request on
 * first view.
 *
 * @param params.assetModelId - The model the asset is being linked to
 * @param params.organizationId - Org scope; a foreign model resolves to null
 * @returns The model's signed image fields, or null when it has no image
 */
export async function getInheritableAssetModelImage({
  assetModelId,
  organizationId,
}: {
  assetModelId: AssetModel["id"];
  organizationId: Organization["id"];
}): Promise<InheritableAssetModelImage | null> {
  const assetModel = await db.assetModel.findFirst({
    where: { id: assetModelId, organizationId },
    select: { image: true, imageExpiration: true },
  });

  if (!assetModel?.image) {
    return null;
  }

  return {
    image: assetModel.image,
    /**
     * `refreshExpiredAssetImages` skips rows whose `mainImageExpiration` is
     * null, so copying a null through would leave the inheriting asset with a
     * URL that lapses and is never re-signed. Treat an unknown expiration as
     * already elapsed: the next read re-signs it from the storage path, which is
     * self-healing and costs one signed-URL call.
     */
    imageExpiration: assetModel.imageExpiration ?? new Date(0),
    thumbnailImage: await signAssetModelThumbnail(assetModel.image),
  };
}

/**
 * Re-signs the shared thumbnail that sits next to a model's cover image.
 *
 * Degrades to null (never throws) — a missing thumbnail just means the client
 * regenerates it lazily, which is the pre-existing behaviour for any asset
 * without one.
 *
 * @param imageUrl - Signed URL of the model's full-size image
 * @returns A signed thumbnail URL, or null when the path can't be resolved
 */
async function signAssetModelThumbnail(
  imageUrl: string
): Promise<string | null> {
  const imagePath = extractStoragePath(imageUrl, ASSET_MODEL_IMAGE_BUCKET);
  if (!imagePath) {
    return null;
  }

  try {
    return await createSignedUrl({
      filename: getThumbnailStoragePath(imagePath),
      bucketName: ASSET_MODEL_IMAGE_BUCKET,
    });
  } catch {
    Logger.info(
      `Failed to sign the thumbnail for asset-model image ${imagePath}; the client will regenerate it`
    );
    return null;
  }
}

/**
 * Uploads (or replaces) an asset model's cover image and propagates it to the
 * model's assets that don't have an image of their own.
 *
 * This is the write half of the "upload once, show on every asset of this
 * model" contract the customer asked for: the file is stored ONCE, and each
 * inheriting asset simply stores a signed URL pointing at that single object.
 *
 * Mirrors `updateKitImage` (`~/modules/kit/service.server`) — same multipart
 * parse → resize → sign → persist shape — with two deliberate differences:
 * the bucket is `assets` (see {@link ASSET_MODEL_IMAGE_BUCKET}) and the write
 * fans out to inheriting assets via {@link propagateAssetModelImageToAssets}.
 *
 * No-ops when the submitted form carries no file, so a plain "Save" on the
 * model form never clears an existing image.
 *
 * @param params.request - The raw (un-consumed) multipart request
 * @param params.assetModelId - Model receiving the image
 * @param params.userId - Uploading user; also the storage path prefix
 * @param params.organizationId - Org scope for both the model and asset writes
 * @returns The signed URL that was stored, or null when no file was submitted
 * @throws {ShelfError} If parsing, uploading, signing or persisting fails
 */
export async function updateAssetModelImage({
  request,
  assetModelId,
  userId,
  organizationId,
}: {
  request: Request;
  assetModelId: AssetModel["id"];
  userId: User["id"];
  organizationId: Organization["id"];
}) {
  try {
    const fileData = await parseFileFormData({
      request,
      bucketName: ASSET_MODEL_IMAGE_BUCKET,
      newFileName: `${userId}/${ASSET_MODEL_IMAGE_PATH_SEGMENT}/${assetModelId}/image-${dateTimeInUnix(
        Date.now()
      )}`,
      resizeOptions: {
        width: 800,
        withoutEnlargement: true,
      },
      /**
       * Generate the 108px thumbnail up front. Inheriting assets are stamped
       * with it, so N assets sharing this model don't each fire
       * `/api/asset/generate-thumbnail` on first render to produce the one
       * shared object.
       */
      generateThumbnail: true,
      thumbnailSize: 108,
      maxFileSize: ASSET_MAX_IMAGE_UPLOAD_SIZE,
    });

    const uploaded = fileData.get("image") as string;
    /** No file submitted — leave any existing image untouched. */
    if (!uploaded) {
      return null;
    }

    /**
     * With `generateThumbnail`, the parser returns a JSON blob carrying both
     * paths; without it, a bare path string. Handle both, same as
     * `updateAssetMainImage`.
     */
    const { imagePath, thumbnailPath } = parseUploadedImagePaths(uploaded);

    const [image, thumbnailImage] = await Promise.all([
      createSignedUrl({
        filename: imagePath,
        bucketName: ASSET_MODEL_IMAGE_BUCKET,
      }),
      thumbnailPath
        ? createSignedUrl({
            filename: thumbnailPath,
            bucketName: ASSET_MODEL_IMAGE_BUCKET,
          }).catch(() => null)
        : Promise.resolve(null),
    ]);

    /**
     * `createSignedUrl` mints a 72h URL (see the invariant comment in
     * `~/utils/storage.server`), and this expiration is copied onto every
     * inheriting asset — a shorter value would make `refreshExpiredAssetImages`
     * re-sign each of them days before the URL actually lapses.
     */
    const imageExpiration = threeDaysFromNow();

    await db.assetModel.update({
      where: { id: assetModelId, organizationId },
      data: { image, imageExpiration },
    });

    await propagateAssetModelImageToAssets({
      assetModelId,
      organizationId,
      image,
      imageExpiration,
      thumbnailImage,
    });

    return image;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while updating the image for this asset model.",
      additionalData: { assetModelId, userId, field: "image" },
      label,
    });
  }
}

/**
 * Unwraps what `parseFileFormData` returned for the uploaded image.
 *
 * With `generateThumbnail: true` the value is a JSON blob carrying both paths;
 * otherwise it is a bare storage path. Mirrors the unwrap in
 * `updateAssetMainImage` (`~/modules/asset/service.server`).
 *
 * @param uploaded - The raw value read off the parsed form data
 * @returns The full-size image path and, when present, its thumbnail path
 */
function parseUploadedImagePaths(uploaded: string): {
  imagePath: string;
  thumbnailPath: string | null;
} {
  try {
    const parsed = JSON.parse(uploaded) as {
      originalPath?: string;
      thumbnailPath?: string;
    };

    if (parsed.originalPath) {
      return {
        imagePath: parsed.originalPath,
        thumbnailPath: parsed.thumbnailPath ?? null,
      };
    }
  } catch {
    // Not JSON — the parser returned a bare path.
  }

  return { imagePath: uploaded, thumbnailPath: null };
}

/**
 * Points every "inheriting" asset of a model at the model's current image.
 *
 * An asset inherits when it has no image at all (`mainImage` is null) or when
 * the image it shows is the model's own shared object (see
 * {@link isAssetModelImageUrl}). Assets with their own uploaded image are left
 * alone — an explicit per-asset upload always wins.
 *
 * All inheriting assets point at the SAME two storage objects (the image and
 * its thumbnail), so storage holds one image + one thumbnail per model no
 * matter how many assets share it.
 *
 * @param params.assetModelId - Model whose image changed
 * @param params.organizationId - Org scope for the write
 * @param params.image - Freshly-signed model image URL
 * @param params.imageExpiration - Expiration of that signed URL
 * @param params.thumbnailImage - Signed URL of the shared thumbnail, if any
 * @returns Number of assets that were re-stamped
 */
export async function propagateAssetModelImageToAssets({
  assetModelId,
  organizationId,
  image,
  imageExpiration,
  thumbnailImage,
}: {
  assetModelId: AssetModel["id"];
  organizationId: Organization["id"];
  image: string;
  imageExpiration: Date;
  thumbnailImage: string | null;
}) {
  const candidates = await db.asset.findMany({
    where: { assetModelId, organizationId },
    select: { id: true, mainImage: true },
  });

  const inheriting = candidates.filter(
    (asset) =>
      asset.mainImage === null ||
      isAssetModelImageUrl(asset.mainImage, assetModelId)
  );

  return writeGuardedByObservedImage(inheriting, organizationId, {
    mainImage: image,
    mainImageExpiration: imageExpiration,
    thumbnailImage,
  });
}

/**
 * Applies an image write to assets, guarded on the `mainImage` each row was
 * observed to have.
 *
 * The ownership decision ("is this asset inheriting, or does it have its own
 * image?") happens in application code against a prior read, so a plain
 * `updateMany` by id would clobber an image uploaded in the gap between that
 * read and this write — the exact case the per-asset-image-wins contract must
 * not lose. Carrying the observed value in the predicate makes each row's write
 * conditional: a row that changed underneath simply matches zero rows and keeps
 * whatever it now holds. Same optimistic-concurrency shape
 * `refreshExpiredAssetImages` uses for its deferred re-signed URLs.
 *
 * Rows are grouped by observed value, so the common case (all null, or all
 * showing the same model URL) is a single query.
 *
 * @param assets - Rows to write, each carrying the `mainImage` just read
 * @param organizationId - Org scope for the write
 * @param data - The image fields to set
 * @returns Number of rows that actually changed
 */
async function writeGuardedByObservedImage(
  assets: { id: string; mainImage: string | null }[],
  organizationId: Organization["id"],
  data: {
    mainImage: string | null;
    mainImageExpiration: Date | null;
    thumbnailImage: string | null;
  }
) {
  if (assets.length === 0) {
    return 0;
  }

  /** observed `mainImage` → ids of the assets that had it */
  const idsByObservedImage = new Map<string | null, string[]>();
  assets.forEach((asset) => {
    const ids = idsByObservedImage.get(asset.mainImage);
    if (ids) {
      ids.push(asset.id);
      return;
    }
    idsByObservedImage.set(asset.mainImage, [asset.id]);
  });

  const results = await Promise.all(
    [...idsByObservedImage.entries()].map(([observedImage, ids]) =>
      db.asset.updateMany({
        where: { id: { in: ids }, organizationId, mainImage: observedImage },
        data,
      })
    )
  );

  return results.reduce((total, result) => total + result.count, 0);
}

/**
 * Clears inherited cover images from the assets of the given models.
 *
 * Called just BEFORE a model is deleted, while its rows still exist to identify
 * — `Asset.assetModelId` is `ON DELETE SET NULL`, so after the delete there is
 * no way to tell which assets were showing that model's photo. Without this an
 * asset would keep displaying the picture of a model that no longer exists:
 * exactly the two-signals-to-reconcile state the unlink path already avoids.
 *
 * Assets with their own uploaded image are untouched.
 *
 * @param params.assetModelIds - Models about to be deleted
 * @param params.organizationId - Org scope for the write
 * @returns Number of assets whose inherited image was cleared
 */
export async function clearInheritedAssetModelImages({
  assetModelIds,
  organizationId,
}: {
  assetModelIds: AssetModel["id"][];
  organizationId: Organization["id"];
}) {
  if (assetModelIds.length === 0) {
    return 0;
  }

  const candidates = await db.asset.findMany({
    where: { assetModelId: { in: assetModelIds }, organizationId },
    select: { id: true, mainImage: true, assetModelId: true },
  });

  const inheriting = candidates.filter((asset) =>
    isAssetModelImageUrl(asset.mainImage, asset.assetModelId ?? undefined)
  );

  return writeGuardedByObservedImage(inheriting, organizationId, {
    mainImage: null,
    mainImageExpiration: null,
    thumbnailImage: null,
  });
}

/**
 * Re-signs expired Supabase signed image URLs for a set of asset models, in
 * place.
 *
 * Mirrors `refreshExpiredKitImages` (`~/modules/kit/service.server`): the
 * settings list and edit form need a URL that still resolves, and signed URLs
 * live for 72h. Failures are logged and swallowed — a stale URL degrades to
 * the client-side broken-image fallback rather than failing the page.
 *
 * @param assetModels - Rows carrying `id`, `organizationId`, `image` and
 *   `imageExpiration`
 * @returns The same array with fresh `image`/`imageExpiration` where refreshed
 */
export async function refreshExpiredAssetModelImages<
  T extends {
    id: string;
    organizationId: string;
    image: string | null;
    imageExpiration: Date | null;
  },
>(assetModels: T[]): Promise<T[]> {
  const now = new Date();
  const expired = assetModels.filter(
    (model) =>
      model.image &&
      model.imageExpiration &&
      new Date(model.imageExpiration) < now
  );

  if (expired.length === 0) {
    return assetModels;
  }

  const results = await Promise.allSettled(
    expired.map(async (model) => {
      const imagePath = extractStoragePath(
        model.image!,
        ASSET_MODEL_IMAGE_BUCKET
      );
      if (!imagePath) {
        return null;
      }

      const image = await createSignedUrl({
        filename: imagePath,
        bucketName: ASSET_MODEL_IMAGE_BUCKET,
      });
      const imageExpiration = threeDaysFromNow();

      /**
       * Guarded on the image we read, so a cover replaced (and propagated to
       * this model's assets) between that read and this write is not overwritten
       * with a re-signed URL for the superseded object. Zero rows matched means
       * a newer cover won — drop this refresh and let the next load re-read.
       */
      const { count } = await db.assetModel.updateMany({
        where: {
          id: model.id,
          organizationId: model.organizationId,
          image: model.image,
        },
        data: { image, imageExpiration },
      });

      if (count === 0) {
        return null;
      }

      return { id: model.id, image, imageExpiration };
    })
  );

  const refreshed = new Map<string, { image: string; imageExpiration: Date }>();
  results.forEach((result, index) => {
    if (result.status === "fulfilled" && result.value) {
      refreshed.set(result.value.id, {
        image: result.value.image,
        imageExpiration: result.value.imageExpiration,
      });
      return;
    }

    if (result.status === "rejected") {
      Logger.info(
        `Failed to refresh image for asset model ${expired[index].id}, proceeding with stale URL`
      );
    }
  });

  if (refreshed.size === 0) {
    return assetModels;
  }

  return assetModels.map((model) => {
    const fresh = refreshed.get(model.id);
    return fresh ? { ...model, ...fresh } : model;
  });
}

/**
 * Deletes an asset model by ID, scoped to the given organization.
 * Assets referencing this model will have their assetModelId set to null.
 */
export async function deleteAssetModel({
  id,
  organizationId,
}: Pick<AssetModel, "id"> & { organizationId: Organization["id"] }) {
  try {
    /**
     * Runs BEFORE the delete: once the model row is gone, `ON DELETE SET NULL`
     * has erased the link that identifies which assets were inheriting from it.
     */
    await clearInheritedAssetModelImages({
      assetModelIds: [id],
      organizationId,
    });

    const result = await db.assetModel.deleteMany({
      where: { id, organizationId },
    });

    if (result.count === 0) {
      throw new ShelfError({
        cause: null,
        title: "Asset model not found",
        message:
          "The asset model you are trying to delete does not exist or you do not have permission to delete it.",
        additionalData: { id, organizationId },
        label,
        status: 404,
      });
    }

    return result;
  } catch (cause) {
    /** Re-throw ShelfErrors (e.g. the not-found check above) as-is */
    if (cause instanceof ShelfError) {
      throw cause;
    }

    throw new ShelfError({
      cause,
      message:
        "Something went wrong while deleting the asset model. Please try again or contact support.",
      additionalData: { id, organizationId },
      label,
    });
  }
}

/**
 * Resolves AssetModel references from a CSV-import payload to existing model
 * IDs, creating any that do not yet exist in the workspace.
 *
 * Mirrors the shape of `createCategoriesIfNotExists` / `createKitsIfNotExists`
 * so the CSV importer can drop this into the same `Promise.all` pre-resolve
 * batch. Match is case-insensitive on `name` (tolerates casing drift in
 * spreadsheets) but writes the trimmed original casing on create.
 *
 * @param params.data - Parsed CSV rows; each row may carry an `assetModel`
 *   string column referencing a model by name
 * @param params.userId - Authoring user for newly-created models
 * @param params.organizationId - Org scope; all reads + writes are filtered
 * @returns Record keyed by the original (un-trimmed) CSV `assetModel` string,
 *   value is the resolved `AssetModel.id`. Rows without an `assetModel` are
 *   skipped — callers should null-coalesce when looking up.
 * @throws {ShelfError} Wrapped error if a create / read fails
 */
export async function createAssetModelsIfNotExists({
  data,
  userId,
  organizationId,
}: {
  data: CreateAssetFromContentImportPayload[];
  userId: User["id"];
  organizationId: Organization["id"];
}): Promise<Record<string, AssetModel["id"]>> {
  try {
    /** Build a Map keyed by the original (un-trimmed) CSV cell so callers
     * can look up by exactly what the row contained, mirroring the
     * `createCategoriesIfNotExists` contract. */
    const models = new Map<string, string>(
      data
        .filter((asset) => asset.assetModel)
        .map((asset) => [asset.assetModel as string, ""])
    );

    for (const [rawName] of models) {
      const trimmed = rawName.trim();
      if (trimmed === "") {
        models.set(rawName, "");
        continue;
      }

      const existing = await db.assetModel.findFirst({
        where: {
          name: { equals: trimmed, mode: "insensitive" },
          organizationId,
        },
      });

      if (existing) {
        models.set(rawName, existing.id);
      } else {
        const created = await db.assetModel.create({
          data: {
            name: trimmed,
            createdBy: { connect: { id: userId } },
            organization: { connect: { id: organizationId } },
          },
        });
        models.set(rawName, created.id);
      }
    }

    return Object.fromEntries(Array.from(models));
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while creating asset models. Seems like some of the asset-model data in your import file is invalid. Please check and try again.",
      additionalData: { userId, organizationId },
      label,
      /** No need to capture those. They are mostly related to malformed CSV data */
      shouldBeCaptured: false,
    });
  }
}

/**
 * Bulk deletes asset models by IDs or all models in the organization.
 * Supports the ALL_SELECTED_KEY pattern for select-all functionality.
 *
 * When ALL_SELECTED_KEY is present and `currentSearchParams` is provided,
 * the deletion is scoped to models matching the active search filters
 * (e.g. name/description search) rather than deleting every model in the org.
 *
 * @param assetModelIds - Array of model IDs to delete, or includes ALL_SELECTED_KEY
 * @param organizationId - Organization scope for the deletion
 * @param currentSearchParams - Serialized URLSearchParams string from the list view,
 *   used to scope ALL_SELECTED deletions to the current filter state
 */
export async function bulkDeleteAssetModels({
  assetModelIds,
  organizationId,
  currentSearchParams,
}: {
  assetModelIds: AssetModel["id"][];
  organizationId: Organization["id"];
  currentSearchParams?: string | null;
}) {
  try {
    let where: Prisma.AssetModelWhereInput;

    if (assetModelIds.includes(ALL_SELECTED_KEY)) {
      where = { organizationId };

      /** When there are active filters, scope the delete to matching models */
      if (currentSearchParams) {
        const params = new URLSearchParams(currentSearchParams);
        const search = params.get("search");

        if (search) {
          where.OR = [
            { name: { contains: search, mode: "insensitive" } },
            { description: { contains: search, mode: "insensitive" } },
          ];
        }
      }
    } else {
      where = { id: { in: assetModelIds }, organizationId };
    }

    /**
     * Resolve the ids first so the inherited-image cleanup and the delete cover
     * exactly the same set — `where` can be filter-driven ("select all" with an
     * active search), and the cleanup needs the links intact to run.
     */
    const matchingModels = await db.assetModel.findMany({
      where,
      select: { id: true },
    });

    await clearInheritedAssetModelImages({
      assetModelIds: matchingModels.map((model) => model.id),
      organizationId,
    });

    return await db.assetModel.deleteMany({
      where: {
        id: { in: matchingModels.map((model) => model.id) },
        organizationId,
      },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while bulk deleting asset models.",
      additionalData: { assetModelIds, organizationId },
      label,
    });
  }
}
