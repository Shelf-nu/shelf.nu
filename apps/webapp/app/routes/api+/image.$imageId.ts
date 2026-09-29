import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import { ShelfError, makeShelfError } from "~/utils/error";
import { error, getParams } from "~/utils/http.server";
import { detectImageFormat } from "~/utils/image-format.server";

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

    /**
     * The stored `contentType` is whatever the uploading client claimed, so it
     * cannot be allowed to decide how a browser renders this response: a
     * claimed `text/html` would turn an authorization-gated image into a
     * document executing on the application origin, where the viewer is
     * authenticated. Derive the type from the bytes instead. Anything the
     * magic-byte detector does not recognize as a raster image is handed back
     * as an opaque download rather than rendered.
     */
    const detectedContentType = detectImageFormat(image.blob);

    return new Response(new Uint8Array(image.blob), {
      headers: {
        "Content-Type": detectedContentType ?? "application/octet-stream",
        "Content-Disposition": detectedContentType
          ? "inline"
          : 'attachment; filename="download"',
        // Defence in depth for the inline case: a navigated image document gets
        // a unique opaque origin and no script execution, so a format that
        // turns out to be scriptable still cannot reach the session. CSP is
        // ignored on subresources, so this cannot affect `<img>` rendering.
        "Content-Security-Policy":
          "script-src 'none'; object-src 'none'; sandbox",
        "X-Content-Type-Options": "nosniff",
        // Stored images are replaced in place (same id, same URL), so renderers
        // version the URL with `?v=<updatedAt>` (see ~/components/shared/image.tsx)
        // — that is what makes a long lifetime safe here. `private` because the
        // response is authorization-gated, so shared caches must not store it.
        "Cache-Control": "private, max-age=31536000",
      },
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
