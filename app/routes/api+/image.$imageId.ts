import type { LoaderFunctionArgs } from "@remix-run/node";
import { db } from "~/database";
import { ShelfError } from "~/utils/error";

export async function loader({ context, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();

  const image = await db.image.findUnique({
    where: { id: params.imageId },
    select: { ownerOrgId: true, contentType: true, blob: true, userId: true },
  });

  // @TODO Solve error handling
  if (!image) {
    throw new ShelfError({
      cause: null,
      message: "Not found",
      status: 404,
      label: "Image",
    });
  }

  const userOrganizations = await db.userOrganization.findMany({
    where: { userId: authSession.userId },
    select: {
      organization: {
        select: { id: true },
      },
    },
  });
  const orgIds = userOrganizations.map((uo) => uo.organization.id);

  if (!orgIds.includes(image.ownerOrgId)) {
    // @TODO Solve error handling
    throw new ShelfError({
      cause: null,
      message: "Unauthorized. This resource doesn't belong to you.",
      status: 403,
      label: "Image",
    });
  }

  return new Response(image.blob, {
    headers: {
      "Content-Type": image.contentType,
      "Cache-Control": "max-age=31536000",
    },
  });
}
