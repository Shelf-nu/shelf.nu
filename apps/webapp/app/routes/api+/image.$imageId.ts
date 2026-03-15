import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import { findFirstOrThrow } from "~/database/query-helpers.server";
import { queryRaw, sql } from "~/database/sql.server";
import { ShelfError, makeShelfError } from "~/utils/error";
import { error, getParams } from "~/utils/http.server";

export async function loader({ context, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { imageId } = getParams(params, z.object({ imageId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const image = await findFirstOrThrow(db, "Image", {
      where: { id: imageId },
      select: "ownerOrgId, contentType, blob, userId",
    }).catch((cause) => {
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

    const orgRows = await queryRaw<{ organizationId: string }>(
      db,
      sql`
        SELECT uo."organizationId"
        FROM "UserOrganization" uo
        WHERE uo."userId" = ${authSession.userId}
      `
    );

    const orgIds = orgRows.map((row) => row.organizationId);

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
