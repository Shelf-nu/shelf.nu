/**
 * Asset Audit History API
 *
 * Returns an asset's recent and upcoming audits for the hover card on the
 * "Last audit date" column. Called lazily on hover so the index loader does
 * not pay for it per row. Gated like the column itself: only callers who see
 * the column as `available` may read it.
 *
 * @see {@link file://./../../modules/audit/asset-audit-history.server.ts}
 */
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { lastAuditDateAccessFor } from "~/modules/asset/last-audit-date-access.server";
import { getAssetAuditHistory } from "~/modules/audit/asset-audit-history.server";
import { ShelfError, makeShelfError } from "~/utils/error";
import { payload, error, getParams } from "~/utils/http.server";
import { assertAssetsBelongToOrg } from "~/utils/org-validation.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

/**
 * Loads the recent and upcoming audits of one asset.
 *
 * @throws {ShelfError} 403 unless the last audit date is available to the caller;
 * the org guard's error when the asset is not in the workspace
 */
export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const { userId } = context.getSession();
  const { assetId } = getParams(params, z.object({ assetId: z.string() }));

  try {
    const { organizationId, access, currentOrganization } =
      await requirePermission({
        userId,
        request,
        entity: PermissionEntity.audit,
        action: PermissionAction.read,
      });

    if (lastAuditDateAccessFor(access, currentOrganization) !== "available") {
      throw new ShelfError({
        cause: null,
        message: "Audit history is not available for this workspace or role.",
        label: "Audit",
        status: 403,
        shouldBeCaptured: false,
      });
    }

    await assertAssetsBelongToOrg({ assetIds: [assetId], organizationId });

    const history = await getAssetAuditHistory({ assetId, organizationId });

    return data(payload(history));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, assetId });
    throw data(error(reason), { status: reason.status });
  }
}
