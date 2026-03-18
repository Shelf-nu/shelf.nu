import type {
  AuditAsset,
  AuditImage,
  AuditSession,
  Organization,
  User,
} from "@prisma/client";
import { sbDb } from "~/database/supabase.server";
import { getSupabaseAdmin } from "~/integrations/supabase/client";
import {
  DEFAULT_MAX_IMAGE_UPLOAD_SIZE,
  PUBLIC_BUCKET,
} from "~/utils/constants";
import type { ErrorLabel } from "~/utils/error";
import { isLikeShelfError, ShelfError } from "~/utils/error";
import {
  getFileUploadPath,
  parseFileFormData,
  removePublicFile,
} from "~/utils/storage.server";

const label: ErrorLabel = "Audit Image";

/** Maximum number of images per asset in an audit */
const MAX_IMAGES_PER_ASSET = 3;

/** Maximum number of general images per audit (not tied to specific assets) */
const MAX_GENERAL_IMAGES_PER_AUDIT = 5;

/**
 * Uploads an image for an audit session.
 * Can be either a general audit image or tied to a specific asset.
 *
 * @param request - The request containing the image file
 * @param auditSessionId - ID of the audit session
 * @param organizationId - ID of the organization
 * @param uploadedById - ID of the user uploading the image
 * @param auditAssetId - Optional ID of the audit asset this image is tied to
 * @param description - Optional description for the image
 * @returns The created AuditImage record
 */
export async function uploadAuditImage({
  request,
  auditSessionId,
  organizationId,
  uploadedById,
  auditAssetId,
  description,
}: {
  request: Request;
  auditSessionId: AuditSession["id"];
  organizationId: Organization["id"];
  uploadedById: User["id"];
  auditAssetId?: AuditAsset["id"];
  description?: string;
}) {
  try {
    // Check image count limits before uploading
    await validateImageLimits({
      auditSessionId,
      auditAssetId,
      organizationId,
    });

    // Parse and upload the file to Supabase storage
    const fileData = await parseFileFormData({
      request,
      bucketName: PUBLIC_BUCKET,
      newFileName: getFileUploadPath({
        organizationId,
        type: "audits",
        typeId: auditSessionId,
      }),
      resizeOptions: {
        width: 1200,
        withoutEnlargement: true,
      },
      generateThumbnail: true,
      thumbnailSize: 108,
      maxFileSize: DEFAULT_MAX_IMAGE_UPLOAD_SIZE,
    });

    const image = fileData.get("image") as string | null;
    if (!image) {
      throw new ShelfError({
        cause: null,
        message: "No image file found in the request",
        additionalData: { auditSessionId, auditAssetId },
        label,
      });
    }

    // Parse the uploaded image paths
    let imagePath: string;
    let thumbnailPath: string | null = null;

    try {
      const parsedImage = JSON.parse(image);
      if (parsedImage.originalPath) {
        imagePath = parsedImage.originalPath;
        thumbnailPath = parsedImage.thumbnailPath;
      } else {
        imagePath = image;
      }
    } catch (_error) {
      imagePath = image;
    }

    // Get public URLs for the uploaded images
    const {
      data: { publicUrl: imagePublicUrl },
    } = getSupabaseAdmin().storage.from(PUBLIC_BUCKET).getPublicUrl(imagePath);

    let thumbnailPublicUrl: string | undefined;
    if (thumbnailPath) {
      const {
        data: { publicUrl },
      } = getSupabaseAdmin()
        .storage.from(PUBLIC_BUCKET)
        .getPublicUrl(thumbnailPath);
      thumbnailPublicUrl = publicUrl;
    }

    // Create the database record
    const { data: auditImage, error: createError } = await sbDb
      .from("AuditImage")
      .insert({
        imageUrl: imagePublicUrl,
        thumbnailUrl: thumbnailPublicUrl ?? null,
        description: description ?? null,
        auditSessionId,
        auditAssetId: auditAssetId ?? null,
        uploadedById,
        organizationId,
      })
      .select()
      .single();

    if (createError) throw createError;

    return auditImage;
  } catch (cause) {
    const isShelfError = isLikeShelfError(cause);
    throw new ShelfError({
      cause,
      message: isShelfError ? cause.message : "Failed to upload audit image",
      additionalData: { auditSessionId, auditAssetId },
      label,
    });
  }
}

/**
 * Validates that the image limits are not exceeded.
 * Throws an error if adding another image would exceed the limits.
 */
async function validateImageLimits({
  auditSessionId,
  auditAssetId,
  organizationId,
}: {
  auditSessionId: AuditSession["id"];
  auditAssetId?: AuditAsset["id"];
  organizationId: Organization["id"];
}) {
  if (auditAssetId) {
    // Check asset-specific image limit
    const { count, error } = await sbDb
      .from("AuditImage")
      .select("*", { count: "exact", head: true })
      .eq("auditSessionId", auditSessionId)
      .eq("auditAssetId", auditAssetId)
      .eq("organizationId", organizationId);

    if (error) throw error;

    if ((count ?? 0) >= MAX_IMAGES_PER_ASSET) {
      throw new ShelfError({
        cause: null,
        message: `Maximum of ${MAX_IMAGES_PER_ASSET} images per asset exceeded`,
        title: "Image Limit Exceeded",
        additionalData: {
          auditSessionId,
          auditAssetId,
          currentCount: count,
        },
        label,
      });
    }
  } else {
    // Check general audit image limit (images not tied to specific assets)
    const { count, error } = await sbDb
      .from("AuditImage")
      .select("*", { count: "exact", head: true })
      .eq("auditSessionId", auditSessionId)
      .is("auditAssetId", null)
      .eq("organizationId", organizationId);

    if (error) throw error;

    if ((count ?? 0) >= MAX_GENERAL_IMAGES_PER_AUDIT) {
      throw new ShelfError({
        cause: null,
        message: `Maximum of ${MAX_GENERAL_IMAGES_PER_AUDIT} general images per audit exceeded`,
        additionalData: { auditSessionId, currentCount: count },
        label,
      });
    }
  }
}

/**
 * Deletes an audit image and removes it from storage.
 *
 * @param imageId - ID of the image to delete
 * @param organizationId - ID of the organization (for authorization)
 * @returns true if successful
 */
export async function deleteAuditImage({
  imageId,
  organizationId,
}: {
  imageId: AuditImage["id"];
  organizationId: Organization["id"];
}): Promise<boolean> {
  try {
    // Get the image record to retrieve URLs
    const { data: image, error: findError } = await sbDb
      .from("AuditImage")
      .select("*")
      .eq("id", imageId)
      .eq("organizationId", organizationId)
      .maybeSingle();

    if (findError) throw findError;

    if (!image) {
      throw new ShelfError({
        cause: null,
        message: "Image not found or you don't have permission to delete it",
        additionalData: { imageId, organizationId },
        label,
      });
    }

    // Delete from storage
    await removePublicFile({ publicUrl: image.imageUrl });
    if (image.thumbnailUrl) {
      await removePublicFile({ publicUrl: image.thumbnailUrl });
    }

    // Delete from database
    const { error: deleteError } = await sbDb
      .from("AuditImage")
      .delete()
      .eq("id", imageId);

    if (deleteError) throw deleteError;

    return true;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to delete audit image",
      additionalData: { imageId, organizationId },
      label,
    });
  }
}

/**
 * Gets all images for an audit session.
 *
 * @param auditSessionId - ID of the audit session
 * @param organizationId - ID of the organization
 * @param auditAssetId - Optional: filter by specific audit asset
 * @returns Array of AuditImage records
 */
export async function getAuditImages({
  auditSessionId,
  organizationId,
  auditAssetId,
}: {
  auditSessionId: AuditSession["id"];
  organizationId: Organization["id"];
  auditAssetId?: AuditAsset["id"] | null;
}) {
  try {
    let query = sbDb
      .from("AuditImage")
      .select(
        "*, uploadedBy:User!uploadedById(id, firstName, lastName, profilePicture), auditAsset:AuditAsset!auditAssetId(id, asset:Asset!assetId(id, title))"
      )
      .eq("auditSessionId", auditSessionId)
      .eq("organizationId", organizationId);

    // If auditAssetId is explicitly provided (string), filter by that specific asset
    // If auditAssetId is explicitly null, get only general images (auditAssetId IS NULL in DB)
    // If auditAssetId is undefined, get ALL images (no filter)
    if (auditAssetId === null) {
      query = query.is("auditAssetId", null);
    } else if (auditAssetId !== undefined) {
      query = query.eq("auditAssetId", auditAssetId);
    }

    const { data: images, error } = await query.order("createdAt", {
      ascending: false,
    });

    if (error) throw error;

    return images;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to get audit images",
      additionalData: { auditSessionId, organizationId, auditAssetId },
      label,
    });
  }
}

/**
 * Gets the count of images for an audit session, optionally filtered by asset.
 *
 * @param auditSessionId - ID of the audit session
 * @param organizationId - ID of the organization
 * @param auditAssetId - Optional: filter by specific audit asset
 * @returns Number of images
 */
export async function getAuditImageCount({
  auditSessionId,
  organizationId,
  auditAssetId,
}: {
  auditSessionId: AuditSession["id"];
  organizationId: Organization["id"];
  auditAssetId?: AuditAsset["id"];
}): Promise<number> {
  try {
    let query = sbDb
      .from("AuditImage")
      .select("*", { count: "exact", head: true })
      .eq("auditSessionId", auditSessionId)
      .eq("organizationId", organizationId);

    if (auditAssetId !== undefined) {
      query = query.eq("auditAssetId", auditAssetId);
    }

    const { count, error } = await query;

    if (error) throw error;

    return count ?? 0;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to get audit image count",
      additionalData: { auditSessionId, organizationId, auditAssetId },
      label,
    });
  }
}
