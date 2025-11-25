import { AssetIndexMode } from "@prisma/client";
import { data, type LoaderFunctionArgs } from "@remix-run/node";
import { getAssetIndexSettings } from "~/modules/asset-index-settings/service.server";
import {
  exportAssetsBackupToCsv,
  exportAssetsFromIndexToCsv,
} from "~/utils/csv.server";
import { makeShelfError } from "~/utils/error";
import { error, getCurrentSearchParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { assertUserCanExportAssets } from "~/utils/subscription.server";

export const loader = async ({ context, request }: LoaderFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId, organizations, currentOrganization, role } =
      await requirePermission({
        userId: authSession.userId,
        request,
        entity: PermissionEntity.asset,
        action: PermissionAction.export,
      });

    await assertUserCanExportAssets({ organizationId, organizations });

    /** Get the setttings, we need them for a few things */
    const settings = await getAssetIndexSettings({
      userId,
      organizationId,
      canUseBarcodes: currentOrganization.barcodesEnabled ?? false,
      role,
    });
    const { mode } = settings;

    const searchParams = getCurrentSearchParams(request);
    const assetIds = searchParams.get("assetIds");
    const assetIndexCurrentSearchParams = searchParams.get(
      "assetIndexCurrentSearchParams"
    );
    const isBackupRequest = assetIds === null;

    /** Join the rows with a new line */
    const csvString =
      !isBackupRequest && mode === AssetIndexMode.ADVANCED && assetIds
        ? await exportAssetsFromIndexToCsv({
            request,
            assetIds,
            settings,
            currentOrganization,
            assetIndexCurrentSearchParams,
          })
        : await exportAssetsBackupToCsv({ organizationId });

    return new Response(csvString, {
      status: 200,
      headers: {
        "content-type": "text/csv",
      },
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
};
