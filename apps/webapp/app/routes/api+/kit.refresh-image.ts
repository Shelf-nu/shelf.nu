import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { extractStoragePath } from "~/components/assets/asset-image/utils";
import { db } from "~/database/db.server";
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

    const { kitId } = parseData(
      await request.formData(),
      z.object({
        kitId: z.string(),
      })
    );

    // Re-sign the kit's own stored image, never a URL from the request: the
    // signed URL is written back onto the kit, and deleting the kit removes
    // the file that URL names.
    const storedKit = await db.kit.findFirst({
      where: { id: kitId, organizationId },
      select: { image: true },
    });

    const filename = storedKit?.image
      ? extractStoragePath(storedKit.image, "kits")
      : null;

    if (!filename) {
      throw new ShelfError({
        cause: null,
        message: "Cannot find kit filename",
        additionalData: { userId, kitId },
        label: "Kit",
        status: 404,
        shouldBeCaptured: false,
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

    return data(payload({ kit }));
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(error(reason), { status: reason.status });
  }
}
