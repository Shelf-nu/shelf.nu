import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";

import { resolveAssetIdsForBulkOperation } from "~/modules/asset/bulk-operations-helper.server";
import { CurrentSearchParamsSchema } from "~/modules/asset/utils.server";
import { getAssetIndexSettings } from "~/modules/asset-index-settings/service.server";
import {
  addAssetsToAudit,
  requireAuditAssignee,
} from "~/modules/audit/service.server";
import { scopeCustodianFilterIds } from "~/modules/team-member/service.server";
import { getClientHint } from "~/utils/client-hints";
import { resolveUserFormatPrefsById } from "~/utils/date-format.server";
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

    const {
      organizationId,
      canUseBarcodes,
      role,
      canSeeAllCustody,
      isSelfServiceOrBase,
    } = await requirePermission({
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

    // `audit: update` authorizes updating audits in general, never THIS audit.
    // Without this a BASE or SELF_SERVICE member could widen the scope of any
    // pending audit in the workspace — adding assets to one they were never
    // assigned to. ADMIN/OWNER are unrestricted. (detail.dev D043)
    await requireAuditAssignee({
      auditSessionId: auditId,
      organizationId,
      userId,
      isSelfServiceOrBase,
    });

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

      // Acting user's timezone: the select-all set is resolved from the current
      // date filters, which must truncate the day in the user's tz (avoids an
      // off-by-one for non-UTC users).
      const { timeZone } = await resolveUserFormatPrefsById(
        userId,
        getClientHint(request)
      );

      assetIds = await resolveAssetIdsForBulkOperation({
        assetIds: directAssetIds,
        organizationId,
        currentSearchParams,
        settings,
        timeZone,
        // `audit: update` is held by BASE and SELF_SERVICE, and the resulting
        // audit lists the assets it resolved — so a custodian filter here has
        // to be narrowed to the caller's own custody.
        allowedTeamMemberIds: await scopeCustodianFilterIds({
          teamMemberIds: new URLSearchParams(currentSearchParams ?? "").getAll(
            "teamMember"
          ),
          canSeeAllCustody,
          userId,
          organizationId,
        }),
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
