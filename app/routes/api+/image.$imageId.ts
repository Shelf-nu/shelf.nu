import type { LoaderFunctionArgs } from "@remix-run/node";
import { db } from "~/database";
import { ShelfStackError } from "~/utils/error";

export async function loader({ context, params }: LoaderFunctionArgs) {
  const authSession = await context.getSession();

  if (!authSession)
    throw new ShelfStackError({
      message: "Unauthorized. You are not allowed to view this resource",
      status: 403,
    });
  const image = await db.image.findUnique({
    where: { id: params.imageId },
    select: { ownerOrgId: true, contentType: true, blob: true, userId: true },
  });
  if (!image) throw new ShelfStackError({ message: "Not found", status: 404 });

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
