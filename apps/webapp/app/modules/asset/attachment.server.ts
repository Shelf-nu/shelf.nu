/**
 * Asset Attachments
 *
 * An asset can carry one PDF: a purchase invoice, a manual, a calibration
 * certificate. The file lives in the private `assets` bucket at
 * `<organizationId>/<folderId>/attachment-<unix>-<uuid>.pdf`, and the asset
 * row stores that path in `attachmentPath`, never a URL.
 *
 * `folderId` is the asset's id when the file is uploaded from the edit page.
 * On the create form the asset does not exist yet, so the form picks a
 * placeholder id and the file is "staged" under it; `createAsset` then checks
 * the staged path with {@link resolveStagedAttachment} and stores it.
 *
 * Every key that reaches Storage is built or checked here. Storage resolves
 * `.` and `..` segments inside a key, so an id that becomes a path segment
 * must match {@link ATTACHMENT_FOLDER_ID_PATTERN}, and a path a client sends
 * back must pass {@link parseAttachmentPath} for the caller's workspace.
 * Anything looser lets a member read or write another workspace's objects.
 *
 * Nobody is handed a long-lived link. Pages link to
 * `GET /api/asset/:assetId/attachment`, which checks permission on every click
 * and redirects to a URL signed for {@link ATTACHMENT_LINK_TTL_SECONDS}
 * seconds, so a copied or forwarded link stops working almost at once.
 *
 * @see {@link file://./../../routes/api+/asset.$assetId.attachment.ts} the
 *   viewing, upload and remove endpoint
 * @see {@link file://./service.server.ts} `createAsset`
 */

import type { Asset, Organization } from "@prisma/client";
import { db } from "~/database/db.server";
import { dateTimeInUnix } from "~/utils/date-time-in-unix";
import type { AdditionalData, ErrorLabel } from "~/utils/error";
import { isLikeShelfError, ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import {
  createSignedUrl,
  listFilesInFolder,
  parsePdfFormData,
  removeFileAtPath,
  removeFilesAtPaths,
} from "~/utils/storage.server";

const label: ErrorLabel = "Assets";

/** The private bucket attachments are stored in. */
const ATTACHMENT_BUCKET = "assets";

/**
 * An id that becomes the folder segment of an attachment key: an asset id
 * (a cuid) or the create form's placeholder (a UUID). Letters, digits, `_`
 * and `-` only, so it can never be `.`, `..` or contain a `/`.
 */
export const ATTACHMENT_FOLDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** The workspace segment of an attachment key. Same alphabet as a folder id. */
const ORGANIZATION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/** The file name of every attachment: `attachment-<unix>-<uuid>.pdf`. */
const ATTACHMENT_FILE_NAME_PATTERN =
  /^attachment-\d+-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/;

/**
 * Seconds a signed attachment URL stays valid. The viewing route signs on
 * every click, so the URL only has to survive the redirect.
 */
export const ATTACHMENT_LINK_TTL_SECONDS = 60;

/** The longest attachment name kept, in characters. */
export const MAX_ATTACHMENT_NAME_LENGTH = 255;

/**
 * Characters removed from an attachment name before it is stored: control
 * characters, and format characters such as the bidi overrides that make
 * `invoice<U+202E>fdp.exe` render as "invoiceexe.pdf".
 */
const UNSAFE_NAME_CHARACTERS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/**
 * The refusal for an attachment path or id that does not belong where the
 * request says it does. Deliberately vague: it does not say which check failed.
 */
function invalidAttachmentError(additionalData: AdditionalData) {
  return new ShelfError({
    cause: null,
    title: "Invalid attachment",
    message: "The attached file is not valid. Please upload it again.",
    additionalData,
    label,
    status: 400,
    shouldBeCaptured: false,
  });
}

/**
 * Builds the storage key for a new attachment, without the `.pdf` extension
 * (`parsePdfFormData` appends it).
 *
 * @param params.organizationId - The caller's workspace
 * @param params.folderId - The asset's id, or the create form's placeholder id
 * @returns `<organizationId>/<folderId>/attachment-<unix>-<uuid>`
 * @throws {ShelfError} 400 when either id is not a safe path segment
 */
export function buildAttachmentKey({
  organizationId,
  folderId,
}: {
  organizationId: Organization["id"];
  folderId: string;
}): string {
  if (
    !ORGANIZATION_ID_PATTERN.test(organizationId) ||
    !ATTACHMENT_FOLDER_ID_PATTERN.test(folderId)
  ) {
    throw invalidAttachmentError({ organizationId, folderId });
  }

  return `${organizationId}/${folderId}/attachment-${dateTimeInUnix(
    Date.now()
  )}-${crypto.randomUUID()}`;
}

/**
 * Splits an attachment path into its parts, if it is one this workspace could
 * own: exactly `<organizationId>/<folderId>/attachment-<unix>-<uuid>.pdf`.
 *
 * @param path - A stored or client-supplied attachment path
 * @param organizationId - The caller's workspace
 * @returns The folder id and file name, or `null` when the path has any other
 *   shape (another workspace, a `..` segment, a different file name)
 */
export function parseAttachmentPath(
  path: string,
  organizationId: Organization["id"]
): { folderId: string; fileName: string } | null {
  const segments = path.split("/");
  if (segments.length !== 3) return null;

  const [workspaceSegment, folderId, fileName] = segments;
  if (
    workspaceSegment !== organizationId ||
    !ATTACHMENT_FOLDER_ID_PATTERN.test(folderId) ||
    !ATTACHMENT_FILE_NAME_PATTERN.test(fileName)
  ) {
    return null;
  }

  return { folderId, fileName };
}

/**
 * Cleans the file name a person uploaded before it is stored and shown: drops
 * control and format characters (bidi overrides, zero-width characters),
 * trims, and keeps at most {@link MAX_ATTACHMENT_NAME_LENGTH} characters.
 *
 * @param name - The name the browser sent, if any
 * @returns The cleaned name, or `null` when nothing readable is left
 */
export function sanitizeAttachmentName(
  name: string | null | undefined
): string | null {
  if (!name) return null;

  const cleaned = name.replace(UNSAFE_NAME_CHARACTERS, "").trim();
  if (!cleaned) return null;

  // Counted in code points, so a cut never splits an emoji in half.
  return Array.from(cleaned).slice(0, MAX_ATTACHMENT_NAME_LENGTH).join("");
}

/**
 * Uploads (or replaces) the PDF attachment of an existing asset.
 *
 * Standalone rather than part of `updateAsset()`: the edit page uploads the
 * file on drop, through its own endpoint, independent of the rest of the form.
 * The new path is saved before the old file is deleted, so a failure leaves an
 * orphaned file rather than an asset pointing at nothing.
 *
 * @param params.request - The multipart request carrying the PDF
 * @param params.assetId - The asset, already proven to be in the workspace
 * @param params.organizationId - The caller's workspace
 * @returns The updated asset
 * @throws {ShelfError} When the asset is missing or archived, the upload is
 *   refused, or the database write fails
 */
export async function updateAssetAttachment({
  request,
  assetId,
  organizationId,
}: {
  request: Request;
  assetId: Asset["id"];
  organizationId: Organization["id"];
}) {
  try {
    // An archived asset is read-only; the route refuses it with a message
    // first, so this only stops a caller that skipped that check.
    const asset = await db.asset.findFirstOrThrow({
      where: { id: assetId, organizationId, archivedAt: null },
      select: { id: true, attachmentPath: true },
    });

    const { path, originalName, size } = await parsePdfFormData({
      request,
      newFileName: buildAttachmentKey({ organizationId, folderId: assetId }),
    });

    let updated;
    try {
      updated = await db.asset.update({
        where: { id: assetId, organizationId },
        data: {
          attachmentPath: path,
          attachmentOriginalName: sanitizeAttachmentName(originalName),
          attachmentSize: size,
        },
      });
    } catch (cause) {
      // Nothing points at the new file, so it would only ever be a leftover.
      await removeFileAtPath({ path, bucketName: ATTACHMENT_BUCKET }).catch(
        (removeCause: unknown) =>
          Logger.error(
            new ShelfError({
              cause: removeCause,
              message: "Failed to remove an attachment that was not saved",
              additionalData: { assetId },
              label,
            })
          )
      );
      throw cause;
    }

    if (asset.attachmentPath) {
      // Best effort: the targeted delete leaves the new file in the same
      // folder alone, and a leftover file is not worth failing the upload over.
      try {
        await removeFileAtPath({
          path: asset.attachmentPath,
          bucketName: ATTACHMENT_BUCKET,
        });
      } catch (cause) {
        Logger.error(
          new ShelfError({
            cause,
            message: "Failed to delete the previous asset attachment",
            additionalData: { assetId },
            label,
          })
        );
      }
    }

    return updated;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while uploading the asset attachment",
      additionalData: { assetId },
      label,
      status: isLikeShelfError(cause) ? cause.status : undefined,
    });
  }
}

/**
 * Removes an existing asset's attachment: clears the three columns, then
 * deletes the file (best effort, for the same reason as
 * {@link updateAssetAttachment}).
 *
 * @param params.assetId - The asset, already proven to be in the workspace
 * @param params.organizationId - The caller's workspace
 * @returns The updated asset
 * @throws {ShelfError} When the asset is missing or archived, or the database
 *   write fails
 */
export async function removeAssetAttachment({
  assetId,
  organizationId,
}: {
  assetId: Asset["id"];
  organizationId: Organization["id"];
}) {
  try {
    // An archived asset is read-only; the route refuses it with a message
    // first, so this only stops a caller that skipped that check.
    const asset = await db.asset.findFirstOrThrow({
      where: { id: assetId, organizationId, archivedAt: null },
      select: { id: true, attachmentPath: true },
    });

    const updated = await db.asset.update({
      where: { id: assetId, organizationId },
      data: {
        attachmentPath: null,
        attachmentOriginalName: null,
        attachmentSize: null,
      },
    });

    if (asset.attachmentPath) {
      try {
        await removeFileAtPath({
          path: asset.attachmentPath,
          bucketName: ATTACHMENT_BUCKET,
        });
      } catch (cause) {
        Logger.error(
          new ShelfError({
            cause,
            message: "Failed to delete the removed asset attachment",
            additionalData: { assetId },
            label,
          })
        );
      }
    }

    return updated;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while removing the asset attachment",
      additionalData: { assetId },
      label,
      status: isLikeShelfError(cause) ? cause.status : undefined,
    });
  }
}

/**
 * Uploads a PDF for an asset that is still being created. Storage only: the
 * create form keeps the returned path in a hidden field, and `createAsset`
 * checks and stores it with {@link resolveStagedAttachment}.
 *
 * @param params.request - The multipart request carrying the PDF
 * @param params.placeholderId - The create form's placeholder id, used as the
 *   folder segment
 * @param params.organizationId - The caller's workspace
 * @returns The staged path, the cleaned original name and the size in bytes.
 *   Files staged earlier under the same placeholder are removed.
 *   The create form opens the file through the viewing route, by placeholder
 *   id, so no URL is returned.
 * @throws {ShelfError} When the placeholder id is unsafe or the upload is
 *   refused
 */
export async function stageAssetAttachment({
  request,
  placeholderId,
  organizationId,
}: {
  request: Request;
  placeholderId: string;
  organizationId: Organization["id"];
}) {
  try {
    const { path, originalName, size } = await parsePdfFormData({
      request,
      newFileName: buildAttachmentKey({
        organizationId,
        folderId: placeholderId,
      }),
    });

    // The create form holds one file, so anything staged earlier under this
    // placeholder is now unreachable. Best effort: the upload already worked.
    try {
      await removeUnclaimedStagedFiles({
        placeholderId,
        organizationId,
        keepPath: path,
      });
    } catch (cause) {
      Logger.error(
        new ShelfError({
          cause,
          message: "Failed to remove earlier staged attachments",
          additionalData: { placeholderId, organizationId },
          label,
        })
      );
    }

    return {
      attachmentPath: path,
      attachmentOriginalName: sanitizeAttachmentName(originalName),
      attachmentSize: size,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while uploading the asset attachment",
      additionalData: { placeholderId },
      label,
      status: isLikeShelfError(cause) ? cause.status : undefined,
    });
  }
}

/**
 * Removes the PDF staged under a create form's placeholder id. No row records
 * the exact key yet, so the placeholder folder is cleared, except files an
 * asset already owns.
 *
 * @param params.placeholderId - The create form's placeholder id
 * @param params.organizationId - The caller's workspace
 * @throws {ShelfError} When the placeholder id is unsafe or Storage refuses
 */
export async function clearStagedAssetAttachment({
  placeholderId,
  organizationId,
}: {
  placeholderId: string;
  organizationId: Organization["id"];
}) {
  try {
    await removeUnclaimedStagedFiles({ placeholderId, organizationId });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while removing the asset attachment",
      additionalData: { placeholderId },
      label,
      status: isLikeShelfError(cause) ? cause.status : undefined,
    });
  }
}

/**
 * Deletes the files in a placeholder folder that no asset owns.
 *
 * The placeholder id comes from the client, and asset pages expose stored
 * attachment paths, so a folder named here can hold a file an asset already
 * stores (a created asset keeps the path it was staged under). Those files
 * are never deleted from here.
 *
 * @param params.placeholderId - The create form's placeholder id
 * @param params.organizationId - The caller's workspace
 * @param params.keepPath - A path to leave alone, such as the file just staged
 * @throws {ShelfError} 400 for an unsafe placeholder id, or when Storage or
 *   the database refuses
 */
async function removeUnclaimedStagedFiles({
  placeholderId,
  organizationId,
  keepPath,
}: {
  placeholderId: string;
  organizationId: Organization["id"];
  keepPath?: string;
}) {
  if (!ATTACHMENT_FOLDER_ID_PATTERN.test(placeholderId)) {
    throw invalidAttachmentError({ organizationId, placeholderId });
  }

  const folder = `${organizationId}/${placeholderId}`;
  const files = await listFilesInFolder({
    folder,
    bucketName: ATTACHMENT_BUCKET,
  });
  const candidates = files
    .map((file) => `${folder}/${file.name}`)
    .filter((path) => path !== keepPath);
  if (candidates.length === 0) return;

  const owned = await db.asset.findMany({
    // eslint-disable-next-line local-rules/require-archived-at-check-on-asset-queries -- why: an archived asset keeps its attachment
    where: { organizationId, attachmentPath: { in: candidates } },
    select: { attachmentPath: true },
  });
  const ownedPaths = new Set(owned.map((asset) => asset.attachmentPath));
  const unowned = candidates.filter((path) => !ownedPaths.has(path));
  if (unowned.length === 0) return;

  await removeFilesAtPaths({ paths: unowned, bucketName: ATTACHMENT_BUCKET });
}

/**
 * Removes the attachment files of assets that were just deleted.
 *
 * `removeImageFilesOfDeletedAssets` clears each deleted asset's own folder,
 * but a file staged on the create form stays in its placeholder folder, so it
 * is removed here by its stored path.
 *
 * Call it only after the rows are deleted. Best effort, and never rejects: a
 * failure is logged, because the delete has already happened.
 *
 * @param params.attachmentPaths - The deleted rows' `attachmentPath` values
 * @param params.organizationId - The workspace they were deleted from
 */
export async function removeAttachmentFilesOfDeletedAssets({
  attachmentPaths,
  organizationId,
}: {
  attachmentPaths: (string | null | undefined)[];
  organizationId: Organization["id"];
}): Promise<void> {
  const paths = attachmentPaths.filter(
    (path): path is string => typeof path === "string" && path.length > 0
  );
  if (paths.length === 0) return;

  try {
    await removeFilesAtPaths({ paths, bucketName: ATTACHMENT_BUCKET });
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause,
        message: "Failed to remove attachment files of deleted assets",
        additionalData: { organizationId, fileCount: paths.length },
        label,
      })
    );
  }
}

/**
 * Checks a staged attachment the create form sends back, and returns what
 * `createAsset` stores. Only the path comes from the client; the size is read
 * from Storage, and the name is cleaned.
 *
 * Refuses a path that is not an attachment key of this workspace, one an
 * asset already owns, and one with no file behind it.
 *
 * @param params.attachmentPath - The staged path from the create form
 * @param params.attachmentOriginalName - The name the form shows for it
 * @param params.organizationId - The caller's workspace
 * @returns The three attachment columns for the new asset
 * @throws {ShelfError} 400 for any refusal, or when Storage cannot be read
 */
export async function resolveStagedAttachment({
  attachmentPath,
  attachmentOriginalName,
  organizationId,
}: {
  attachmentPath: string;
  attachmentOriginalName?: string | null;
  organizationId: Organization["id"];
}): Promise<{
  attachmentPath: string;
  attachmentOriginalName: string | null;
  attachmentSize: number | null;
}> {
  const parsed = parseAttachmentPath(attachmentPath, organizationId);
  if (!parsed) {
    throw invalidAttachmentError({ organizationId, attachmentPath });
  }

  // The column is unique across workspaces, so the check is too.
  const claimedBy = await db.asset.findFirst({
    // eslint-disable-next-line local-rules/require-archived-at-check-on-asset-queries -- why: an archived asset keeps its attachment, so its path is taken
    where: { attachmentPath },
    select: { id: true },
  });
  if (claimedBy) {
    throw invalidAttachmentError({ organizationId, attachmentPath });
  }

  const files = await listFilesInFolder({
    folder: `${organizationId}/${parsed.folderId}`,
    bucketName: ATTACHMENT_BUCKET,
  });
  const stored = files.find((file) => file.name === parsed.fileName);
  if (!stored) {
    throw new ShelfError({
      cause: null,
      title: "Attachment not found",
      message: "The attached file could not be found. Please upload it again.",
      additionalData: { organizationId, attachmentPath },
      label,
      status: 400,
      shouldBeCaptured: false,
    });
  }

  return {
    attachmentPath,
    attachmentOriginalName: sanitizeAttachmentName(attachmentOriginalName),
    attachmentSize: stored.size,
  };
}

/**
 * Finds the PDF currently staged under a create form's placeholder id: the
 * newest attachment file in the placeholder folder.
 *
 * @param params.placeholderId - The create form's placeholder id
 * @param params.organizationId - The caller's workspace
 * @returns The staged path, or `null` when nothing is staged
 * @throws {ShelfError} 400 for an unsafe placeholder id, or when Storage
 *   cannot be read
 */
export async function findStagedAttachmentPath({
  placeholderId,
  organizationId,
}: {
  placeholderId: string;
  organizationId: Organization["id"];
}): Promise<string | null> {
  if (!ATTACHMENT_FOLDER_ID_PATTERN.test(placeholderId)) {
    throw invalidAttachmentError({ organizationId, placeholderId });
  }

  const folder = `${organizationId}/${placeholderId}`;
  const files = await listFilesInFolder({
    folder,
    bucketName: ATTACHMENT_BUCKET,
  });

  // `attachment-<unix>-...`: the largest timestamp is the newest upload.
  const uploadedAt = (name: string) => Number(name.split("-")[1]);
  const newest = files
    .map((file) => file.name)
    .filter((name) => ATTACHMENT_FILE_NAME_PATTERN.test(name))
    .sort((a, b) => uploadedAt(b) - uploadedAt(a))[0];

  return newest ? `${folder}/${newest}` : null;
}

/**
 * Signs an attachment path for the viewing route's redirect. The URL lives
 * {@link ATTACHMENT_LINK_TTL_SECONDS} seconds: long enough to open, too short
 * to be worth sharing. Callers must already have checked that the viewer may
 * see the asset; this does no permission check of its own.
 *
 * @param attachmentPath - A stored or staged attachment path
 * @returns The signed URL
 * @throws {ShelfError} When Storage refuses to sign
 */
export function signAttachmentForViewing(attachmentPath: string) {
  return createSignedUrl({
    filename: attachmentPath,
    bucketName: ATTACHMENT_BUCKET,
    expiresIn: ATTACHMENT_LINK_TTL_SECONDS,
  });
}
