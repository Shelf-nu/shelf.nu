/**
 * Asset import status endpoint.
 *
 * `GET /api/asset-imports/:importId` returns the progress of one import for
 * the progress UI to poll. Reading it also fails an import that stopped moving,
 * so a dead job surfaces as FAILED instead of RUNNING forever. The response
 * never carries the stored rows or warnings.
 *
 * @see {@link file://./../../modules/asset-import/service.server.ts}
 * @see {@link file://./../_layout+/assets.import.$importId.tsx}
 */
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { getAssetImportStatus } from "~/modules/asset-import/service.server";
import { makeShelfError } from "~/utils/error";
import { payload, error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

/**
 * Returns the status of an import in the active workspace.
 *
 * @throws 404 when the import is not in this workspace or is still a draft,
 * 403 without `asset: import`
 */
export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const { userId } = context.getSession();

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.import,
    });

    const { importId } = getParams(
      params,
      z.object({ importId: z.string().min(1) })
    );

    const status = await getAssetImportStatus({
      importId,
      organizationId,
      userId,
    });

    return data(payload({ import: status }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
