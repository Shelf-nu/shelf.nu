import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { updateKit } from "~/modules/kit/service.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { payload, error, parseData } from "~/utils/http.server";
import { oneDayFromNow } from "~/utils/one-week-from-now";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { createSignedUrl } from "~/utils/storage.server";

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    // This is kind of a special case. Even tho we are editing the kit by updating the image
    // we should still use "read" permission because we need base and self-service users to be able to see the images
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.kit,
      action: PermissionAction.read,
    });

    const { kitId, image } = parseData(
      await request.formData(),
      z.object({
        kitId: z.string(),
        image: z.string(),
      })
    );

    const url = new URL(image);
    const path = url.pathname;

    const start = path.indexOf("/kits/");

    const filename = start !== -1 ? path.slice(start + "/kits/".length) : null;

    if (!filename) {
      throw new ShelfError({
        cause: null,
        message: "Cannot find kit filename",
        additionalData: { userId, kitId, image },
        label: "Kit",
      });
    }

    const signedUrl = await createSignedUrl({ filename, bucketName: "kits" });

    const kit = await updateKit({
      id: kitId,
      image: signedUrl,
      imageExpiration: oneDayFromNow(),
      createdById: userId,
      organizationId,
    });

    return payload({ kit });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(error(reason), { status: reason.status });
  }
}
