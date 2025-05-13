import { json } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { v4 as uuid } from "uuid";
import { Button } from "~/components/shared/button";
import { db } from "~/database/db.server";
import { getSupabaseAdmin } from "~/integrations/supabase/client";
import { PUBLIC_BUCKET } from "~/utils/constants";
import { cropImage } from "~/utils/crop-image";
import { makeShelfError, ShelfError } from "~/utils/error";
import { data, error } from "~/utils/http.server";
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
export async function action({ context }: ActionFunctionArgs) {
  const { userId } = context.getSession();

  try {
    await requireAdmin(userId);

    const locationWithImages = await db.location.findMany({
      where: { image: { isNot: null } },
      select: {
        id: true,
        organizationId: true,
        image: true,
      },
      take: 100, // Limit to 100 locations to avoid moving too many images at once
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

    for (const location of locationWithImages) {
      if (!location.image) {
        continue;
      }

      const extension = location.image.contentType.split("/").at(-1);
      const baseFileName = `${location.organizationId}/locations/${
        location.id
      }/${uuid()}`;

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
        continue;
      }

      /** Getting the public url that we can use to retrieve the image on frontend */
      const {
        data: { publicUrl: thumbnailPublicUrl },
      } = supabase.storage.from(PUBLIC_BUCKET).getPublicUrl(thumbnailData.path);

      await db.location.update({
        where: { id: location.id },
        data: {
          imageUrl: publicUrl,
          thumbnailUrl: thumbnailPublicUrl,
        },
      });

      movedLocationIds.push(location.id);
    }

    /** Disconnecting all the images from locations */
    await Promise.all(
      movedLocationIds.map((id) =>
        db.location.update({
          where: { id },
          data: { image: { disconnect: true } },
        })
      )
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
}

export default function MoveLocationImages() {
  const { numberOfLocationWithImages } = useLoaderData<typeof loader>();

  return (
    <div className="rounded-md border bg-white p-4">
      <h2 className="mb-1">Move location images</h2>
      <p className="mb-4">
        Move the location images from the database to Supabase Storage and
        update the image URLs for each location accordingly.
      </p>

      <form method="POST">
        <Button disabled={numberOfLocationWithImages === 0}>
          Move{" "}
          {numberOfLocationWithImages < 100
            ? numberOfLocationWithImages
            : "first 100"}{" "}
          images
        </Button>
      </form>
    </div>
  );
}
