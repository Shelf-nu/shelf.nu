import type { LoaderArgs } from "@remix-run/node";
import { db } from "~/database";
import { getAuthSession } from "~/modules/auth";

export async function loader({ request, params }: LoaderArgs) {
  const session = await getAuthSession(request);

  if (!session)
    throw new Response(
      "Unauthorized. You are not allowed to view this resource",
      { status: 403 }
    );
  const image = await db.image.findUnique({
    where: { id: params.imageId },
    select: { contentType: true, blob: true, userId: true },
  });

  /** If the image doesnt belong to the user who has the session. Throw an error. */
  if (image?.userId !== session.userId) {
    throw new Response("Unauthorized. This resource doesn't belong to you.", {
      status: 403,
    });
  }

  if (!image) throw new Response("Not found", { status: 404 });

  return new Response(image.blob, {
    headers: {
      "Content-Type": image.contentType,
      "Cache-Control": "max-age=31536000",
    },
  });
}
