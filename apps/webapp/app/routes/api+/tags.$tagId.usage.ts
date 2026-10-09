/**
 * GET /api/tags/:tagId/usage
 *
 * What uses one tag, for its delete dialog: the dialog asks for the name to
 * be typed only when something does. Loaded when the dialog opens, so the
 * tags index does not count usage for every row it lists. The delete action
 * re-checks with the same service, so this answer is a hint, not the guard.
 *
 * @see {@link file://../../components/tag/delete-tag.tsx} - The consumer
 * @see {@link file://../../modules/tag/service.server.ts} - `getTagUsage`
 */
import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { getTagUsage } from "~/modules/tag/service.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { payload, error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function loader({ context, params, request }: LoaderFunctionArgs) {
  const { userId } = context.getSession();
  const { tagId } = getParams(params, z.object({ tagId: z.string() }));

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.tag,
      action: PermissionAction.delete,
    });

    const found = await getTagUsage({ id: tagId, organizationId });

    if (!found) {
      throw new ShelfError({
        cause: null,
        title: "Tag not found",
        message: "The tag you are trying to delete does not exist.",
        additionalData: { tagId, organizationId },
        label: "Tag",
        status: 404,
        shouldBeCaptured: false,
      });
    }

    return data(payload({ usage: found.usage }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, tagId });
    return data(error(reason), { status: reason.status });
  }
}
