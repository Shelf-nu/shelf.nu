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
 * @see {@link file://./../../routes/api+/asset.$assetId.attachment.ts} the
 *   upload and remove endpoint
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
  removeFilesByPrefix,
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
 * @throws {ShelfError} When the asset is missing, the upload is refused, or
 *   the database write fails
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
    const asset = await db.asset.findFirstOrThrow({
      // eslint-disable-next-line local-rules/require-archived-at-check-on-asset-queries -- why: the route resolves the asset (archived included) before calling this
      where: { id: assetId, organizationId },
      select: { id: true, attachmentPath: true },
    });

    const { path, originalName, size } = await parsePdfFormData({
      request,
      newFileName: buildAttachmentKey({ organizationId, folderId: assetId }),
    });

    const updated = await db.asset.update({
      where: { id: assetId, organizationId },
      data: {
        attachmentPath: path,
        attachmentOriginalName: sanitizeAttachmentName(originalName),
        attachmentSize: size,
      },
    });

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
 * @throws {ShelfError} When the asset is missing or the database write fails
 */
export async function removeAssetAttachment({
  assetId,
  organizationId,
}: {
  assetId: Asset["id"];
  organizationId: Organization["id"];
}) {
  try {
    const asset = await db.asset.findFirstOrThrow({
      // eslint-disable-next-line local-rules/require-archived-at-check-on-asset-queries -- why: the route resolves the asset (archived included) before calling this
      where: { id: assetId, organizationId },
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
 * @returns The staged path, the cleaned original name, the size in bytes, and
 *   a signed URL for showing the file on the create form right away
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

    // Shown only on this response, so the person can open what they just
    // uploaded. Never stored.
    const attachmentDisplayUrl = await createSignedUrl({
      filename: path,
      bucketName: ATTACHMENT_BUCKET,
    });

    return {
      attachmentPath: path,
      attachmentDisplayUrl,
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
 * the exact key yet, so the whole placeholder folder is cleared.
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
  if (!ATTACHMENT_FOLDER_ID_PATTERN.test(placeholderId)) {
    throw invalidAttachmentError({ organizationId, placeholderId });
  }

  try {
    await removeFilesByPrefix({
      organizationId,
      entityId: placeholderId,
      bucketName: ATTACHMENT_BUCKET,
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while removing the asset attachment",
      additionalData: { placeholderId },
      label,
    });
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
 * Signs an asset's stored attachment path for display. Callers must already
 * have checked that the viewer may see the asset; this does no permission
 * check of its own.
 *
 * Returns `null` instead of throwing when signing fails, so a storage hiccup
 * shows "no attachment" rather than failing the page.
 *
 * @param params.attachmentPath - The stored path, or `null`
 * @param params.assetId - For the log line only
 * @returns A signed URL, or `null`
 */
export async function resolveAssetAttachmentDisplayUrl({
  attachmentPath,
  assetId,
}: {
  attachmentPath: Asset["attachmentPath"];
  assetId: Asset["id"];
}): Promise<string | null> {
  if (!attachmentPath) {
    return null;
  }

  try {
    return await createSignedUrl({
      filename: attachmentPath,
      bucketName: ATTACHMENT_BUCKET,
    });
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause,
        message: "Failed to create a signed URL for the asset attachment",
        additionalData: { assetId },
        label,
        shouldBeCaptured: true,
      })
    );
    return null;
  }
}
