/**
 * Active asset import endpoint.
 *
 * `GET /api/asset-imports/active` returns the workspace's import in flight
 * (or the viewer's recently finished one), shaped for the viewer the same way
 * the layout loader shapes it. The assets index notice polls it so its count
 * follows the import. Any member who can read assets may call it; members
 * without import permission get only the progress fields.
 *
 * The static `active` segment ranks above the `:importId` param of
 * `asset-imports.$importId.ts`, so this route is never shadowed by it.
 *
 * @see {@link file://./../../modules/asset-import/viewer-payload.ts}
 * @see {@link file://./../../components/assets/assets-index/asset-import-notice.tsx}
 * @see {@link file://./../_layout+/_layout.tsx} Loader that builds the initial value
 */
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getActiveAssetImport } from "~/modules/asset-import/service.server";
import { shapeActiveImportForViewer } from "~/modules/asset-import/viewer-payload";
import { makeShelfError } from "~/utils/error";
import { payload, error } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { hasPermission } from "~/utils/permissions/permission.validator.server";
import { requirePermission } from "~/utils/roles.server";

/**
 * Returns the active import of the current workspace for the viewer.
 *
 * @returns `{ import }`: the full status payload for importers, the narrow
 * notice payload for everyone else, null when nothing is active
 * @throws 403 without `asset: read`
 */
export async function loader({ context, request }: LoaderFunctionArgs) {
  const { userId } = context.getSession();

  try {
    const { organizationId, userOrganizations } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.read,
    });

    const roles =
      userOrganizations.find((o) => o.organization.id === organizationId)
        ?.roles ?? [];

    const [canImport, active] = await Promise.all([
      hasPermission({
        organizationId,
        userId,
        roles,
        // why: no workspace switch grants this action.
        workspace: null,
        entity: PermissionEntity.asset,
        action: PermissionAction.import,
      }),
      getActiveAssetImport({ userId, organizationId }),
    ]);

    return data(
      payload({ import: shapeActiveImportForViewer(active, canImport) })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
