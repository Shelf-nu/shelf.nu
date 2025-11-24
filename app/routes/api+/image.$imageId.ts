import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import { ShelfError, makeShelfError } from "~/utils/error";
import { error, getParams } from "~/utils/http.server";

export async function loader({ context, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { imageId } = getParams(params, z.object({ imageId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const image = await db.image
      .findFirstOrThrow({
        where: { id: imageId },
        select: {
          ownerOrgId: true,
          contentType: true,
          blob: true,
          userId: true,
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          title: "Image not found",
          message:
            "The image you are trying to access does not exist or you do not have permission to access it.",
          additionalData: { userId, imageId },
          status: 404,
          label: "Image",
        });
      });

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
      throw new ShelfError({
        cause: null,
        message: "Unauthorized. This resource doesn't belong to you.",
        additionalData: {
          userId,
          imageId,
          orgIds,
          ownerOrgId: image.ownerOrgId,
        },
        status: 403,
        label: "Image",
      });
    }

    return new Response(new Uint8Array(image.blob), {
      headers: {
        "Content-Type": image.contentType,
        "Cache-Control": "max-age=31536000",
      },
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
