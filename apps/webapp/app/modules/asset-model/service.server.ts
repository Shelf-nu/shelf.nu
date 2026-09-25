import type { AssetModel, Organization, Prisma, User } from "@prisma/client";
import { db } from "~/database/db.server";
import { getSupabaseAdmin } from "~/integrations/supabase/client";
import type { RecordEventTxClient } from "~/modules/activity-event/service.server";
import { recordEvents } from "~/modules/activity-event/service.server";
import {
  buildAssetModelChangeNote,
  resolveUserLink,
} from "~/modules/note/helpers.server";
import { createLoadUserForNotes } from "~/modules/note/load-user-for-notes.server";
import type { NotesTxClient } from "~/modules/note/service.server";
import { createNotes } from "~/modules/note/service.server";
import { ASSET_MAX_IMAGE_UPLOAD_SIZE, PUBLIC_BUCKET } from "~/utils/constants";
import type { ErrorLabel } from "~/utils/error";
import {
  ShelfError,
  isLikeShelfError,
  maybeUniqueConstraintViolation,
} from "~/utils/error";
import { ALL_SELECTED_KEY } from "~/utils/list";
import { assertCategoryBelongsToOrg } from "~/utils/org-validation.server";
import { getFileUploadPath, parseFileFormData } from "~/utils/storage.server";
import type { CreateAssetFromContentImportPayload } from "../asset/types";

const label: ErrorLabel = "Asset Model";

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
  // why: defaultCategoryId comes from form input and Prisma's foreign key
  // only proves the row exists, not that it belongs to this workspace —
  // without this the model would connect another tenant's category. Runs
  // outside the try so its 400 reaches the form instead of being rewritten
  // into the generic constraint-violation message.
  if (defaultCategoryId) {
    await assertCategoryBelongsToOrg({
      categoryId: defaultCategoryId,
      organizationId,
    });
  }

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
        /**
         * How many of this model's assets currently show its cover image —
         * i.e. those with no image of their own. Surfaced on the edit form so
         * the user knows the blast radius before replacing the picture.
         */
        _count: { select: { assets: { where: { mainImage: null } } } },
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
  // why: defaultCategoryId comes from form input and Prisma's foreign key
  // only proves the row exists, not that it belongs to this workspace —
  // without this the model would connect another tenant's category. Runs
  // outside the try so its 400 reaches the form instead of being rewritten
  // into the generic constraint-violation message.
  if (defaultCategoryId) {
    await assertCategoryBelongsToOrg({
      categoryId: defaultCategoryId,
      organizationId,
    });
  }

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

/**
 * Uploads (or replaces) an asset model's cover image.
 *
 * The image is written to the PUBLIC `files` bucket and stored as a permanent
 * public URL — the same treatment `Location.imageUrl` gets. Nothing is copied
 * onto the model's assets: they resolve this URL at render time via
 * `resolveAssetImage`, so one upload serves every inheriting asset, the URL
 * never expires and needs no re-signing, and the browser caches a single
 * object for a whole page of same-model assets.
 *
 * No-ops when the submitted form carries no file, so a plain "Save" on the
 * model form never clears an existing image.
 *
 * @param params.request - The raw (un-consumed) multipart request
 * @param params.assetModelId - Model receiving the image
 * @param params.organizationId - Org scope for the write
 * @returns The stored public URL, or null when no file was submitted
 * @throws {ShelfError} If parsing, uploading or persisting fails
 * @see {@link file://./../asset/image-resolution.ts}
 */
export async function updateAssetModelImage({
  request,
  assetModelId,
  organizationId,
}: {
  request: Request;
  assetModelId: AssetModel["id"];
  organizationId: Organization["id"];
}): Promise<string | null> {
  try {
    const fileData = await parseFileFormData({
      request,
      bucketName: PUBLIC_BUCKET,
      newFileName: getFileUploadPath({
        organizationId,
        type: "asset-models",
        typeId: assetModelId,
      }),
      resizeOptions: {
        width: 800,
        withoutEnlargement: true,
      },
      /**
       * Generate the 108px thumbnail up front so inheriting assets render at
       * list sizes immediately, instead of every one of them shipping the
       * full-size original into a 108px cell.
       */
      generateThumbnail: true,
      thumbnailSize: 108,
      maxFileSize: ASSET_MAX_IMAGE_UPLOAD_SIZE,
    });

    const uploaded = fileData.get("image") as string | null;
    /** No file submitted — leave any existing image untouched. */
    if (!uploaded) {
      return null;
    }

    /**
     * With `generateThumbnail`, the parser returns a JSON blob carrying both
     * paths; without it, a bare path string. Handle both.
     */
    const { imagePath, thumbnailPath } = parseUploadedImagePaths(uploaded);

    const {
      data: { publicUrl: image },
    } = getSupabaseAdmin().storage.from(PUBLIC_BUCKET).getPublicUrl(imagePath);

    const thumbnailImage = thumbnailPath
      ? getSupabaseAdmin()
          .storage.from(PUBLIC_BUCKET)
          .getPublicUrl(thumbnailPath).data.publicUrl
      : null;

    /**
     * Org-scoped write: `organizationId` in the predicate means a model id
     * belonging to another workspace matches zero rows instead of being
     * overwritten.
     */
    await db.assetModel.update({
      where: { id: assetModelId, organizationId },
      data: { image, thumbnailImage },
    });

    return image;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while updating the image for this asset model.",
      additionalData: { assetModelId, field: "image" },
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
 * An asset about to be unlinked because the model it holds is being deleted.
 */
type AssetLosingItsModel = {
  id: string;
  assetModel: { id: string; name: string } | null;
};

/**
 * Emit the activity trail for assets whose model link a delete is about to
 * clear.
 *
 * `Asset.assetModelId` is `ON DELETE SET NULL`, so the unlink happens in the
 * database with no application write to hang a history entry off. Without this
 * the model disappears from every asset that held it and leaves nothing behind
 * — the same gap a plain removal already avoids, which is what makes a reader
 * distrust the whole log rather than one field. Emits the same
 * `ASSET_MODEL_CHANGED` event a removal does, per
 * `.claude/rules/bulk-event-parity.md`, which requires cascade side-effects to
 * be recorded too.
 *
 * Runs inside the delete's own transaction: a note written after the commit can
 * fail once the model is already gone, and the retry has nothing left to read.
 *
 * Notes are grouped by the model being left, since that is the only part of the
 * sentence that varies — one statement per model rather than one per asset.
 *
 * @param params.assets - Rows read BEFORE the delete; after it the link is gone
 * @param params.userLink - Rendered link to the acting user, resolved once
 * @param tx - The transaction the delete itself runs in
 */
async function recordAssetModelDeletionUnlinks(
  {
    assets,
    userId,
    userLink,
    organizationId,
  }: {
    assets: AssetLosingItsModel[];
    userId: User["id"];
    userLink: string;
    organizationId: Organization["id"];
  },
  tx: NotesTxClient & RecordEventTxClient
) {
  if (assets.length === 0) {
    return;
  }

  await recordEvents(
    assets.map((asset) => ({
      organizationId,
      actorUserId: userId,
      action: "ASSET_MODEL_CHANGED" as const,
      entityType: "ASSET" as const,
      entityId: asset.id,
      assetId: asset.id,
      field: "assetModelId",
      fromValue: asset.assetModel?.id ?? null,
      toValue: null,
    })),
    tx
  );

  const byModel = new Map<string, AssetLosingItsModel[]>();
  for (const asset of assets) {
    const key = asset.assetModel?.id ?? "";
    const group = byModel.get(key);
    if (group) {
      group.push(asset);
    } else {
      byModel.set(key, [asset]);
    }
  }

  for (const group of byModel.values()) {
    const content = buildAssetModelChangeNote({
      userLink,
      previous: group[0].assetModel,
      next: null,
      // The model is gone workspace-wide, so the note names the deletion and
      // renders the name unlinked — its page would 404.
      previousDeleted: true,
    });
    if (!content) {
      continue;
    }
    await createNotes(
      {
        content,
        type: "UPDATE",
        userId,
        assetIds: group.map((asset) => asset.id),
        organizationId,
      },
      tx
    );
  }
}

/**
 * Deletes an asset model by ID, scoped to the given organization.
 */
export async function deleteAssetModel({
  id,
  organizationId,
  userId,
}: Pick<AssetModel, "id"> & {
  organizationId: Organization["id"];
  /** Actor for the unlink events and notes the delete cascades into */
  userId: User["id"];
}) {
  try {
    /**
     * Read before the delete. `ON DELETE SET NULL` clears `assetModelId` on
     * every asset this model holds, so once the row is gone nothing records
     * which assets changed or what they left.
     *
     * No image cleanup is needed on those assets: they never stored a copy of
     * the model's image, so `resolveAssetImage` falls through to the
     * placeholder on its own.
     */
    const assetsLosingTheModel = await db.asset.findMany({
      where: { assetModelId: id, organizationId },
      select: { id: true, assetModel: { select: { id: true, name: true } } },
    });

    // Resolved outside the transaction: it can hit the user table, and every
    // note in this batch is written by the same person.
    const userLink = await resolveUserLink({
      userId,
      loadUserForNotes: createLoadUserForNotes(userId),
    });

    const result = await db.$transaction(
      async (tx) => {
        await recordAssetModelDeletionUnlinks(
          {
            assets: assetsLosingTheModel,
            userId,
            userLink,
            organizationId,
          },
          tx
        );

        const deleted = await tx.assetModel.deleteMany({
          where: { id, organizationId },
        });

        if (deleted.count === 0) {
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

        return deleted;
      },
      // One event and one note per asset the model holds, all inside the
      // delete. Prisma's 5s interactive default has aborted comparable asset
      // writes with P2028; 15s matches the ceiling those took.
      { timeout: 15000 }
    );

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
  userId,
}: {
  assetModelIds: AssetModel["id"][];
  organizationId: Organization["id"];
  currentSearchParams?: string | null;
  /** Actor for the unlink events and notes the delete cascades into */
  userId: User["id"];
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
     * Resolved before the delete so the assets can be found by the models they
     * hold — `where` may be a workspace-wide select-all, and after the delete
     * `ON DELETE SET NULL` has already erased the links.
     *
     * No image cleanup is needed on those assets — they never stored a copy of
     * their model's image. See {@link deleteAssetModel}.
     */
    const modelsToDelete = await db.assetModel.findMany({
      where,
      select: { id: true },
    });

    const assetsLosingTheirModel =
      modelsToDelete.length > 0
        ? await db.asset.findMany({
            where: {
              assetModelId: { in: modelsToDelete.map((model) => model.id) },
              organizationId,
            },
            select: {
              id: true,
              assetModel: { select: { id: true, name: true } },
            },
          })
        : [];

    // Resolved outside the transaction: it can hit the user table, and every
    // note in this batch is written by the same person.
    const userLink = await resolveUserLink({
      userId,
      loadUserForNotes: createLoadUserForNotes(userId),
    });

    return await db.$transaction(
      async (tx) => {
        await recordAssetModelDeletionUnlinks(
          {
            assets: assetsLosingTheirModel,
            userId,
            userLink,
            organizationId,
          },
          tx
        );

        return tx.assetModel.deleteMany({ where });
      },
      // A select-all spans the whole workspace, so this writes one event and
      // one note per asset in it. 15s matches the ceiling the comparable bulk
      // asset writes took after hitting P2028 on Prisma's 5s default.
      { timeout: 15000 }
    );
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while bulk deleting asset models.",
      additionalData: { assetModelIds, organizationId },
      label,
    });
  }
}
