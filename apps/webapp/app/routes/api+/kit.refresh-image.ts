/**
 * `POST /api/kit/refresh-image`: re-signs a kit's expired image URL.
 *
 * `KitImage` posts the kit id when the URL it rendered has expired. The work
 * (reading the stored image, the own-folder check, signing, saving) lives in
 * `refreshKitImage`.
 *
 * @see {@link file://../../modules/kit/service.server.ts} refreshKitImage
 * @see {@link file://../../components/kits/kit-image.tsx}
 */
import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { refreshKitImage } from "~/modules/kit/service.server";
import { makeShelfError } from "~/utils/error";
import { payload, error, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

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

    // The service reads the image from the kit row; the request names only
    // the kit, so it can never point the kit at another file.
    const kit = await refreshKitImage({ kitId, organizationId, userId });

    return data(payload({ kit }));
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(error(reason), { status: reason.status });
  }
}
