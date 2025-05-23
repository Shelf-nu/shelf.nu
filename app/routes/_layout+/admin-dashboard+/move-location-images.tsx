/* eslint-disable no-console */
import { useState } from "react";
import { json } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import { z } from "zod";
import Input from "~/components/forms/input";
import { Button } from "~/components/shared/button";
import { db } from "~/database/db.server";
import { useDisabled } from "~/hooks/use-disabled";
import { getSupabaseAdmin } from "~/integrations/supabase/client";
import { PUBLIC_BUCKET } from "~/utils/constants";
import { cropImage } from "~/utils/crop-image";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { data, error, parseData } from "~/utils/http.server";
import { id } from "~/utils/id/id.server";
import { requireAdmin } from "~/utils/roles.server";

export async function loader({ context }: LoaderFunctionArgs) {
  const { userId } = context.getSession();

  try {
    await requireAdmin(userId);

    const locationWithImages = await db.location.count({
      where: { image: { isNot: null } },
    });

    return json(
      data({
        numberOfLocationWithImages: locationWithImages,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
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
// Simple validation function that skips problematic images
function validateImageFormat(
  blob: any,
  contentType: string
): { isValid: boolean; reason?: string } {
  if (!blob || blob.length < 10) {
    return { isValid: false, reason: "Empty or too small blob" };
  }

  const uint8Array = new Uint8Array(blob);
  const bytes = Array.from(uint8Array.slice(0, 12));

  // Check for JPEG (FF D8 FF)
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    if (contentType.includes("jpeg") || contentType.includes("jpg")) {
      return { isValid: true };
    }
    return { isValid: false, reason: `JPEG file stored as ${contentType}` };
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
    return { isValid: false, reason: `PNG file stored as ${contentType}` };
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
      return { isValid: false, reason: `WebP file stored as ${contentType}` };
    }
    return { isValid: false, reason: `RIFF file stored as ${contentType}` };
  }

  // Check for MP4/MOV (ftyp box at bytes 4-7: 66 74 79 70)
  if (
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    return { isValid: false, reason: `Video file stored as ${contentType}` };
  }

  // Check for very small files (likely corrupted)
  if (blob.length < 1000) {
    return {
      isValid: false,
      reason: `File too small (${blob.length} bytes), likely corrupted`,
    };
  }

  return { isValid: true }; // Assume valid for other formats
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { userId } = context.getSession();

  try {
    await requireAdmin(userId);
    const formData = await request.formData();
    const { count } = parseData(
      formData,
      z.object({
        count: z.coerce.number().min(1).max(100),
      })
    );

    const locationWithImages = await db.location.findMany({
      where: { image: { isNot: null } },
      select: {
        id: true,
        organizationId: true,
        image: true,
      },
      take: count, // Limit to 100 locations to avoid moving too many images at once
    });

    if (locationWithImages.length === 0) {
      throw new ShelfError({
        cause: null,
        message: "No location images to move",
        status: 400,
        label: "Admin dashboard",
      });
    }

    const supabase = getSupabaseAdmin();

    const movedLocationIds: string[] = [];
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

      if (!validation.isValid) {
        const skipMsg = `Skipping location ${location.id}: ${validation.reason}`;
        console.error(skipMsg);
        errorLog.push(skipMsg);
        skippedLocationIds.push(location.id);
        continue;
      }

      try {
        const extension = location.image.contentType.split("/").at(-1);
        const baseFileName = `${location.organizationId}/locations/${
          location.id
        }/${id()}`;

        const imagePath = `${baseFileName}.${extension}`;
        const thumbnailPath = `${baseFileName}-thumbnail.${extension}`;

        /** Uploading the image */
        const { data, error } = await supabase.storage
          .from(PUBLIC_BUCKET)
          .upload(imagePath, location.image.blob, {
            upsert: true,
            contentType: location.image.contentType,
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

        /** Getting the public url that we can use to retrieve the image on frontend */
        const {
          data: { publicUrl },
        } = supabase.storage.from(PUBLIC_BUCKET).getPublicUrl(data.path);

        /** Generating thumbnail  */
        const thumbnailFile = await cropImage(
          (async function* () {
            await Promise.resolve(); // Satisfy eslint requirement
            yield new Uint8Array(location.image!.blob);
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
              contentType: location.image.contentType,
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

        /** Getting the public url that we can use to retrieve the image on frontend */
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
        console.log(`Successfully processed location ${location.id}`);
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

    const successMsg = `${movedLocationIds.length} location images moved successfully`;
    const warningMsg =
      skippedLocationIds.length > 0
        ? `, ${skippedLocationIds.length} skipped due to format issues`
        : "";

    sendNotification({
      title: "Location images migration completed",
      message: successMsg + warningMsg,
      icon: { name: "success", variant: "success" },
      senderId: userId,
    });

    // Log detailed results
    console.log("Migration Results:");
    console.log(`- Successfully moved: ${movedLocationIds.length}`);
    console.log(`- Skipped due to format issues: ${skippedLocationIds.length}`);
    if (errorLog.length > 0) {
      console.log("Detailed error log:");
      errorLog.forEach((log) => console.log(`  - ${log}`));
    }

    return json(
      data({
        moved: movedLocationIds.length,
        skipped: skippedLocationIds.length,
        errors: errorLog,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
}

export default function MoveLocationImages() {
  const { numberOfLocationWithImages } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const disabled = useDisabled();
  const [count, setCount] = useState(100);

  return (
    <div className="rounded-md border bg-white p-4">
      <h2 className="mb-1">Move location images</h2>
      <p className="mb-4">
        Move the location images from the database to Supabase Storage and
        update the image URLs for each location accordingly.
      </p>
      <p>Total locations with images: {numberOfLocationWithImages}</p>

      <Form method="POST" className="mt-4">
        <Input
          label={"Number of locations to move:"}
          type="number"
          name="count"
          value={count}
          onChange={(e) => setCount(Number(e.currentTarget.value))}
          inputClassName="w-[100px]"
        />
        <div className="mt-4">
          <Button disabled={numberOfLocationWithImages === 0 || disabled}>
            Move {count} location images
          </Button>
        </div>
      </Form>

      {/* Show migration results */}
      {actionData && (
        <div className="mt-6 rounded-md border bg-gray-50 p-4">
          <h3 className="mb-2 font-semibold">Migration Results:</h3>
          <pre className="whitespace-pre-wrap text-sm">
            {`✅ Successfully moved: ${actionData.moved} images
❌ Skipped due to issues: ${actionData.skipped} images

${
  actionData.errors && actionData.errors.length > 0
    ? `Details of skipped images:
${actionData.errors
  .map((error: string, index: number) => `${index + 1}. ${error}`)
  .join("\n")}`
    : "No errors to report."
}`}
          </pre>
        </div>
      )}
    </div>
  );
}
