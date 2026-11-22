/**
 * GET /api/categories/:categoryId/usage
 *
 * What uses one category, for its delete dialog: the dialog asks for the name to
 * be typed only when something does. Loaded when the dialog opens, so the
 * categories index does not count usage for every row it lists. The delete action
 * re-checks with the same service, so this answer is a hint, not the guard.
 *
 * @see {@link file://../../components/category/delete-category.tsx} - The consumer
 * @see {@link file://../../modules/category/service.server.ts} - `getCategoryUsage`
 */
import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { getCategoryUsage } from "~/modules/category/service.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { payload, error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function loader({ context, params, request }: LoaderFunctionArgs) {
  const { userId } = context.getSession();
  const { categoryId } = getParams(
    params,
    z.object({ categoryId: z.string() })
  );

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.category,
      action: PermissionAction.delete,
    });

    const found = await getCategoryUsage({ id: categoryId, organizationId });

    if (!found) {
      throw new ShelfError({
        cause: null,
        title: "Category not found",
        message: "The category you are trying to delete does not exist.",
        additionalData: { categoryId, organizationId },
        label: "Category",
        status: 404,
        shouldBeCaptured: false,
      });
    }

    return data(payload({ usage: found.usage }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, categoryId });
    return data(error(reason), { status: reason.status });
  }
}
