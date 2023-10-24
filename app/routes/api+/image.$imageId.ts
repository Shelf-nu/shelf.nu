import type { LoaderFunctionArgs } from "@remix-run/node";
import { db } from "~/database";
import { getAuthSession } from "~/modules/auth";
import { ShelfStackError } from "~/utils/error";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const session = await getAuthSession(request);

  if (!session)
    throw new ShelfStackError({
      message: "Unauthorized. You are not allowed to view this resource",
      status: 403,
    });
  const image = await db.image.findUnique({
    where: { id: params.imageId },
    select: { ownerOrgId: true, contentType: true, blob: true, userId: true },
  });

  // @TODO we need to fix this, in order to do it we should add the orgId also to the image
  /** If the image doesnt belong to the user who has the session. Throw an error. */
  if (image?.ownerOrgId !== session.organizationId) {
    throw new ShelfStackError({
      message: "Unauthorized. This resource doesn't belong to you.",
      status: 403,
    });
  }

  if (!image) throw new ShelfStackError({ message: "Not found", status: 404 });

  return new Response(image.blob, {
    headers: {
      "Content-Type": image.contentType,
      "Cache-Control": "max-age=31536000",
    },
  });
}
