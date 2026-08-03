import { AssetIndexMode } from "@prisma/client";
import { data, type LoaderFunctionArgs } from "react-router";
import { getAssetIndexSettings } from "~/modules/asset-index-settings/service.server";
import {
  exportAssetsBackupToCsv,
  exportAssetsForImportToCsv,
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

    // Subscription assertion and settings lookup are independent once
    // requirePermission has resolved — run them in parallel
    const [, settings] = await Promise.all([
      assertUserCanExportAssets({ organizationId, organizations }),
      /** Get the setttings, we need them for a few things */
      getAssetIndexSettings({
        userId,
        organizationId,
        canUseBarcodes: currentOrganization.barcodesEnabled ?? false,
        role,
      }),
    ]);
    const { mode } = settings;

    const searchParams = getCurrentSearchParams(request);
    const assetIds = searchParams.get("assetIds");
    const assetIndexCurrentSearchParams = searchParams.get(
      "assetIndexCurrentSearchParams"
    );
    // `exportType=import` requests the importer-native CSV (re-importable
    // into another workspace) instead of the human/analytics export.
    const exportType =
      searchParams.get("exportType") === "import" ? "import" : "standard";
    // `columnScope=all` exports every configured column regardless of the
    // user's current visibility settings; defaults to "visible" (existing
    // behavior) when absent.
    const columnScope =
      searchParams.get("columnScope") === "all" ? "all" : "visible";
    const isBackupRequest = assetIds === null;

    /** Join the rows with a new line */
    let csvString: string;
    if (isBackupRequest) {
      csvString = await exportAssetsBackupToCsv({ organizationId });
    } else if (exportType === "import") {
      // Import-ready works in both index modes (scope forced to "all" in SIMPLE).
      csvString = await exportAssetsForImportToCsv({
        request,
        assetIds,
        settings,
        currentOrganization,
        assetIndexCurrentSearchParams,
        columnScope,
      });
    } else if (mode === AssetIndexMode.ADVANCED) {
      csvString = await exportAssetsFromIndexToCsv({
        request,
        userId,
        assetIds,
        settings,
        currentOrganization,
        assetIndexCurrentSearchParams,
        columnScope,
      });
    } else {
      csvString = await exportAssetsBackupToCsv({ organizationId });
    }

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
