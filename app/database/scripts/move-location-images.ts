/* eslint-disable no-console */

import { v4 as uuid } from "uuid";
import { getSupabaseAdmin } from "~/integrations/supabase/client";
import { PUBLIC_BUCKET } from "~/utils/constants";
import { db } from "../db.server";

/**
 * This script moves the location images from database to the supabase storage.
 * To move the images, we have the following steps:
 * 1. Get all the locations from the database which have images
 * 2. Move the images from the database to the supabase storage
 * 3. Update the url of image in the database in Location table
 *
 * Images are going to be stored in following format:
 * files/organizationId/locations/locationId/imageId
 */
(async function moveLocationImages() {
  console.log("Moving location images to supabase storage...");

  const locationWithImages = await db.location.findMany({
    where: { image: { isNot: null } },
    select: {
      id: true,
      organizationId: true,
      image: true,
    },
  });

  console.log(`Found ${locationWithImages.length} locations with images`);
  let movedImages = 0;

  try {
    const supabase = getSupabaseAdmin();
    for (const location of locationWithImages) {
      if (!location.image) {
        console.log(`Location ${location.id} has no image`);
        continue;
      }

      const extension = location.image.contentType.split("/").at(-1);
      const imagePath = `${location.organizationId}/locations/${
        location.id
      }/${uuid()}.${extension}`;

      /** Uploading the image */
      const { data, error } = await supabase.storage
        .from(PUBLIC_BUCKET)
        .upload(imagePath, location.image.blob);

      if (error) {
        console.error(
          `Error uploading image for location ${location.id}: ${error.message}`
        );
        continue;
      }

      /** Getting the public url that we can use to retrieve the image on frontend */
      const {
        data: { publicUrl },
      } = supabase.storage.from(PUBLIC_BUCKET).getPublicUrl(data.path);

      await db.location.update({
        where: { id: location.id },
        data: {
          imageUrl: publicUrl,
        },
      });

      console.log(
        `Uploaded image [${movedImages + 1}/${locationWithImages.length}]`
      );
    }

    await Promise.all(
      locationWithImages.map((location) =>
        db.location.update({
          where: { id: location.id },
          data: { image: { disconnect: true } },
        })
      )
    );
  } catch (error) {
    console.error("Error moving location images:", error);
  }
})().catch((error) => {
  console.log(error);
});
