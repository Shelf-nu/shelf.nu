import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";

import { resolveAssetIdsForBulkOperation } from "~/modules/asset/bulk-operations-helper.server";
import { CurrentSearchParamsSchema } from "~/modules/asset/utils.server";
import { getAssetIndexSettings } from "~/modules/asset-index-settings/service.server";
import { addAssetsToAudit } from "~/modules/audit/service.server";
import { badRequest, makeShelfError } from "~/utils/error";
import { assertIsPost, error, parseData, payload } from "~/utils/http.server";
import { ALL_SELECTED_KEY } from "~/utils/list";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

const AddAssetsToAuditSchema = z.object({
  auditId: z.string().min(1, "Audit ID is required"),
  assetIds: z.array(z.string()).min(1, "At least one asset must be selected"),
});

export async function action({ request, context }: ActionFunctionArgs) {
  const { userId } = context.getSession();

  try {
    assertIsPost(request);

    const { organizationId, canUseBarcodes, role } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.audit,
      action: PermissionAction.update,
    });

    const formData = await request.formData();

    const {
      auditId,
      assetIds: directAssetIds,
      currentSearchParams,
    } = parseData(
      formData,
      AddAssetsToAuditSchema.and(CurrentSearchParamsSchema),
      {
        additionalData: { organizationId, userId },
      }
    );

    // Determine if we're selecting all items across multiple pages
    const isSelectingAll =
      directAssetIds && directAssetIds.includes(ALL_SELECTED_KEY);

    let assetIds: string[];

    if (isSelectingAll) {
      // When "Select All" is used, resolve IDs using bulk operation helper
      const settings = await getAssetIndexSettings({
        userId,
        organizationId,
        canUseBarcodes,
        role,
      });

      assetIds = await resolveAssetIdsForBulkOperation({
        assetIds: directAssetIds,
        organizationId,
        currentSearchParams,
        settings,
      });
    } else {
      assetIds = directAssetIds;
    }

    if (assetIds.length === 0) {
      throw badRequest("No assets selected", {
        additionalData: {
          validationErrors: {
            assetIds: { message: "At least one asset must be selected" },
          },
        },
      });
    }

    const { addedCount, skippedCount } = await addAssetsToAudit({
      auditId,
      assetIds,
      organizationId,
      userId,
    });

    return data(
      payload({
        success: true,
        addedCount,
        skippedCount,
        auditId,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
