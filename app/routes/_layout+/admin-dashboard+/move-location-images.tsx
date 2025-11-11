/* eslint-disable no-console */
import { useState } from "react";
import { data } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import { useZorm } from "react-zorm";
import { z } from "zod";
import Input from "~/components/forms/input";
import { Button } from "~/components/shared/button";
import { db } from "~/database/db.server";
import { useDisabled } from "~/hooks/use-disabled";
import { getSupabaseAdmin } from "~/integrations/supabase/client";
import { PUBLIC_BUCKET } from "~/utils/constants";
import { cropImage } from "~/utils/crop-image";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { payload, error, parseData } from "~/utils/http.server";
import { id } from "~/utils/id/id.server";
import { requireAdmin } from "~/utils/roles.server";

export const MigrationFormSchema = z.object({
  count: z.coerce.number().min(1).max(150, "Maximum 150 locations at a time"),
  shouldFix: z
    .string()
    .optional()
    .transform((value) => value === "on"),
});

export async function loader({ context }: LoaderFunctionArgs) {
  const { userId } = context.getSession();

  try {
    await requireAdmin(userId);

    const locationWithImages = await db.location.count({
      where: { image: { isNot: null } },
    });

    return payload({
      numberOfLocationWithImages: locationWithImages,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}

/**
 * This action moves the location images from database to the supabase storage.
 * To move the images, we have the following steps:
 * 1. Get all the locations from the database which have images
 * 2. Move the images from the database to the supabase storage
 * 3. Update the url of image in the database in Location table
 *
 * Images are going to be stored in following format:
 * files/organizationId/locations/locationId/imageId
 */

// Enhanced validation function that can suggest fixes
function validateImageFormat(
  blob: any,
  contentType: string
): {
  isValid: boolean;
  reason?: string;
  canFix?: boolean;
  suggestedFix?: "convertWebP" | "updateContentType";
  suggestedContentType?: string;
} {
  if (!blob || blob.length < 10) {
    return { isValid: false, reason: "Empty or too small blob", canFix: false };
  }

  const uint8Array = new Uint8Array(blob);
  const bytes = Array.from(uint8Array.slice(0, 20));

  // Convert first 100 bytes to string to check for text content
  const textDecoder = new TextDecoder("utf-8", { fatal: false });
  const firstChars = textDecoder
    .decode(uint8Array.slice(0, Math.min(100, uint8Array.length)))
    .toLowerCase();

  // Check for HTML content
  if (
    firstChars.includes("<html") ||
    firstChars.includes("<!doctype") ||
    firstChars.includes("<body")
  ) {
    return {
      isValid: false,
      reason: `HTML content stored as ${contentType}`,
      canFix: false,
    };
  }

  // Check for other text formats that shouldn't be images
  if (
    firstChars.includes("<?xml") ||
    firstChars.includes("{") ||
    firstChars.includes("error:")
  ) {
    return {
      isValid: false,
      reason: `Text/XML content stored as ${contentType}`,
      canFix: false,
    };
  }

  // Check for PDF (25 50 44 46)
  if (
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  ) {
    return {
      isValid: false,
      reason: `PDF file stored as ${contentType}`,
      canFix: false,
    };
  }

  // Check for JPEG (FF D8 FF)
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    if (contentType.includes("jpeg") || contentType.includes("jpg")) {
      return { isValid: true };
    }
    return {
      isValid: false,
      reason: `JPEG file stored as ${contentType}`,
      canFix: true,
      suggestedFix: "updateContentType",
      suggestedContentType: "image/jpeg",
    };
  }

  // Check for PNG (89 50 4E 47)
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    if (contentType.includes("png")) {
      return { isValid: true };
    }
    return {
      isValid: false,
      reason: `PNG file stored as ${contentType}`,
      canFix: true,
      suggestedFix: "updateContentType",
      suggestedContentType: "image/png",
    };
  }

  // Check for WebP (RIFF container: 52 49 46 46 + WEBP at byte 8)
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46
  ) {
    if (
      uint8Array.length > 11 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    ) {
      return {
        isValid: false,
        reason: `WebP file stored as ${contentType}`,
        canFix: true,
        suggestedFix: "convertWebP",
        suggestedContentType: "image/jpeg",
      };
    }
    return {
      isValid: false,
      reason: `RIFF file stored as ${contentType}`,
      canFix: false,
    };
  }

  // Check for MP4/MOV (ftyp box at bytes 4-7: 66 74 79 70)
  if (
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    return {
      isValid: false,
      reason: `Video file stored as ${contentType}`,
      canFix: false,
    };
  }

  // Check for very small files (likely corrupted)
  if (blob.length < 1000) {
    return {
      isValid: false,
      reason: `File too small (${blob.length} bytes), likely corrupted`,
      canFix: false,
    };
  }

  // Check for very large files that might cause memory issues
  if (blob.length > 50 * 1024 * 1024) {
    // 50MB
    return {
      isValid: false,
      reason: `File too large (${Math.round(
        blob.length / 1024 / 1024
      )}MB), might cause memory issues`,
      canFix: false,
    };
  }

  return { isValid: true };
}

// WebP to JPEG conversion function using Sharp
async function convertWebPToJPEG(
  webpBlob: any
): Promise<{ success: boolean; jpegBlob?: any; error?: string }> {
  try {
    const sharp = (await import("sharp")).default;
    const jpegBuffer = await sharp(webpBlob).jpeg({ quality: 90 }).toBuffer();
    return { success: true, jpegBlob: jpegBuffer };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// Function to fix image format issues
async function fixImageFormat(
  blob: any,
  validation: any
): Promise<{
  success: boolean;
  fixedBlob?: any;
  fixedContentType?: string;
  error?: string;
}> {
  if (!validation.canFix) {
    return { success: false, error: "Image cannot be fixed" };
  }

  if (validation.suggestedFix === "updateContentType") {
    // Simple fix: just update content type
    return {
      success: true,
      fixedBlob: blob, // Same blob
      fixedContentType: validation.suggestedContentType,
    };
  }

  if (validation.suggestedFix === "convertWebP") {
    // Convert WebP to JPEG
    const conversion = await convertWebPToJPEG(blob);
    if (conversion.success) {
      return {
        success: true,
        fixedBlob: conversion.jpegBlob,
        fixedContentType: "image/jpeg",
      };
    } else {
      return { success: false, error: conversion.error };
    }
  }

  return { success: false, error: "Unknown fix type" };
}

// Function to organize results by type
function organizeResultsByType(errors: string[]) {
  const categories: {
    [key: string]: string[];
  } = {
    "🌐 WebP Files (fixable)": [],
    "🔄 Format Mismatches (fixable)": [],
    "🎥 Video Files (skip)": [],
    "📄 Text/XML Content (skip)": [],
    "💾 Other Issues": [],
  };

  errors.forEach((error) => {
    if (error.includes("WebP file stored as")) {
      categories["🌐 WebP Files (fixable)"].push(error);
    } else if (
      error.includes("JPEG file stored as") ||
      error.includes("PNG file stored as")
    ) {
      categories["🔄 Format Mismatches (fixable)"].push(error);
    } else if (error.includes("Video file stored as")) {
      categories["🎥 Video Files (skip)"].push(error);
    } else if (error.includes("Text/XML content stored as")) {
      categories["📄 Text/XML Content (skip)"].push(error);
    } else {
      categories["💾 Other Issues"].push(error);
    }
  });

  // Only return categories that have items
  return Object.fromEntries(
    Object.entries(categories).filter(([_, items]) => items.length > 0)
  );
}

// Enhanced migration action with validation and fixing
export async function action({ context, request }: ActionFunctionArgs) {
  const { userId } = context.getSession();

  try {
    await requireAdmin(userId);

    // Get parameters from form data
    const formData = await request.formData();
    const { count, shouldFix } = parseData(formData, MigrationFormSchema);

    console.log(`Migration started: count=${count}, shouldFix=${shouldFix}`);

    const locationWithImages = await db.location.findMany({
      where: { image: { isNot: null } },
      select: {
        id: true,
        organizationId: true,
        image: true,
      },
      take: count,
    });

    if (locationWithImages.length === 0) {
      return payload({
        moved: 0,
        fixed: 0,
        skipped: 0,
        resultsByType: {},
        errors: ["No locations with images found to process."],
      });
    }

    const supabase = getSupabaseAdmin();

    const movedLocationIds: string[] = [];
    const fixedLocationIds: string[] = [];
    const skippedLocationIds: string[] = [];
    const errorLog: string[] = [];

    for (const location of locationWithImages) {
      if (!location.image?.blob) {
        continue;
      }

      // Validate image format
      const validation = validateImageFormat(
        location.image.blob,
        location.image.contentType
      );

      let processedBlob = location.image.blob;
      let processedContentType = location.image.contentType;
      let wasFixed = false;

      if (!validation.isValid) {
        if (shouldFix && validation.canFix) {
          // Try to fix the image
          console.log(
            `Attempting to fix location ${location.id}: ${validation.reason}`
          );

          const fixResult = await fixImageFormat(
            location.image.blob,
            validation
          );

          if (fixResult.success) {
            processedBlob = fixResult.fixedBlob!;
            processedContentType = fixResult.fixedContentType!;
            wasFixed = true;

            const fixMsg = `Fixed location ${location.id}: ${validation.reason} → ${processedContentType}`;
            console.log(fixMsg);
            fixedLocationIds.push(location.id);
          } else {
            const fixFailMsg = `Skipping location ${location.id}: ${validation.reason} (fix failed: ${fixResult.error})`;
            console.error(fixFailMsg);
            errorLog.push(fixFailMsg);
            skippedLocationIds.push(location.id);
            continue;
          }
        } else {
          const skipMsg = `Skipping location ${location.id}: ${validation.reason}`;
          console.error(skipMsg);
          errorLog.push(skipMsg);
          skippedLocationIds.push(location.id);
          continue;
        }
      }

      try {
        const extension = processedContentType.split("/").at(-1);
        const baseFileName = `${location.organizationId}/locations/${
          location.id
        }/${id()}`;

        const imagePath = `${baseFileName}.${extension}`;
        const thumbnailPath = `${baseFileName}-thumbnail.${extension}`;

        /** Uploading the image */
        console.log(
          `Uploading image for location ${location.id}, size: ${
            processedBlob.length
          } bytes${wasFixed ? " (fixed)" : ""}`
        );

        const { data, error } = await supabase.storage
          .from(PUBLIC_BUCKET)
          .upload(imagePath, processedBlob, {
            upsert: true,
            contentType: processedContentType,
          });

        if (error) {
          console.error(
            `Failed to upload image for location ${location.id}:`,
            error
          );
          errorLog.push(`Upload failed for ${location.id}: ${error.message}`);
          skippedLocationIds.push(location.id);
          continue;
        }

        /** Getting the public url */
        const {
          data: { publicUrl },
        } = supabase.storage.from(PUBLIC_BUCKET).getPublicUrl(data.path);

        /** Generating thumbnail */
        const thumbnailFile = await cropImage(
          (async function* () {
            await Promise.resolve();
            yield new Uint8Array(processedBlob);
          })(),
          {
            width: 108,
            height: 108,
            fit: "cover",
            withoutEnlargement: true,
          }
        );

        const { data: thumbnailData, error: thumbnailError } =
          await supabase.storage
            .from(PUBLIC_BUCKET)
            .upload(thumbnailPath, thumbnailFile, {
              upsert: true,
              contentType: processedContentType,
            });

        if (thumbnailError) {
          console.error(
            `Failed to upload thumbnail for location ${location.id}:`,
            thumbnailError
          );
          errorLog.push(
            `Thumbnail upload failed for ${location.id}: ${thumbnailError.message}`
          );
          skippedLocationIds.push(location.id);
          continue;
        }

        /** Getting the thumbnail public url */
        const {
          data: { publicUrl: thumbnailPublicUrl },
        } = supabase.storage
          .from(PUBLIC_BUCKET)
          .getPublicUrl(thumbnailData.path);

        await db.location.update({
          where: { id: location.id },
          data: {
            imageUrl: publicUrl,
            thumbnailUrl: thumbnailPublicUrl,
          },
        });

        movedLocationIds.push(location.id);
        console.log(
          `Successfully processed location ${location.id}${
            wasFixed ? " (fixed)" : ""
          }`
        );
      } catch (err) {
        const errorMsg = `Error processing location ${location.id}: ${err}`;
        console.error(errorMsg);
        errorLog.push(errorMsg);
        skippedLocationIds.push(location.id);
      }
    }

    /** Disconnecting all the images from locations */
    if (movedLocationIds.length > 0) {
      await Promise.all(
        movedLocationIds.map((id) =>
          db.location.update({
            where: { id },
            data: { image: { disconnect: true } },
          })
        )
      );
    }

    const successMsg = `${movedLocationIds.length} location images processed successfully`;
    const fixedMsg =
      shouldFix && fixedLocationIds.length > 0
        ? `, ${fixedLocationIds.length} images fixed`
        : "";
    const warningMsg =
      skippedLocationIds.length > 0
        ? `, ${skippedLocationIds.length} skipped`
        : "";

    sendNotification({
      title: "Location images migration completed",
      message: successMsg + fixedMsg + warningMsg,
      icon: { name: "success", variant: "success" },
      senderId: userId,
    });

    // Organize results by type
    const resultsByType = organizeResultsByType(errorLog);

    // Log detailed results
    console.log("Migration Results:");
    console.log(`- Successfully moved: ${movedLocationIds.length}`);
    if (shouldFix) {
      console.log(`- Fixed and moved: ${fixedLocationIds.length}`);
    }
    console.log(`- Skipped: ${skippedLocationIds.length}`);

    return payload({
      moved: movedLocationIds.length,
      fixed: shouldFix ? fixedLocationIds.length : 0,
      skipped: skippedLocationIds.length,
      errors: errorLog,
      resultsByType,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}

export default function MoveLocationImages() {
  const { numberOfLocationWithImages } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const disabled = useDisabled();
  const [count, setCount] = useState(100);
  const [shouldFix, setShouldFix] = useState(false);
  const zo = useZorm("moveLocationImages", MigrationFormSchema);

  return (
    <div className="rounded-md border bg-white p-4">
      <h2 className="mb-1">Move location images</h2>
      <p className="mb-4">
        Move the location images from the database to Supabase Storage and
        update the image URLs for each location accordingly.
      </p>
      <p>Total locations with images: {numberOfLocationWithImages}</p>

      <Form method="POST" className="mt-4" ref={zo.ref}>
        <Input
          label={"Number of locations to move:"}
          type="number"
          name="count"
          value={count}
          onChange={(e) => setCount(Number(e.currentTarget.value))}
          inputClassName="w-[100px]"
          error={zo.errors.count()?.message}
        />

        <div className="mt-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="shouldFix"
              checked={shouldFix}
              onChange={(e) => setShouldFix(e.target.checked)}
              className="rounded border-gray-300"
            />
            <span className="text-sm">
              Fix corrupted JPEG, PNG and WebP images (converts WebP → JPEG,
              fixes format mismatches)
            </span>
          </label>
        </div>

        <div className="mt-4">
          <Button disabled={numberOfLocationWithImages === 0 || disabled}>
            Move {count} location images {shouldFix && "(with fixing)"}
          </Button>
        </div>
      </Form>

      {/* Show migration results organized by type */}
      {actionData && (
        <div className="mt-6 rounded-md border bg-gray-50 p-4">
          <h3 className="mb-2 font-semibold">Migration Results:</h3>
          <pre className="whitespace-pre-wrap text-sm">
            {`✅ Successfully moved: ${actionData.moved} images
${actionData.fixed ? `🔧 Fixed and moved: ${actionData.fixed} images` : ""}
❌ Skipped due to issues: ${actionData.skipped} images

${
  actionData.resultsByType
    ? Object.entries(actionData.resultsByType)
        .map(
          ([type, items]) =>
            `${type}:
${(items as string[])
  .map((item, index) => `  ${index + 1}. ${item}`)
  .join("\n")}`
        )
        .join("\n\n")
    : "No detailed breakdown available."
}`}
          </pre>
        </div>
      )}
    </div>
  );
}
