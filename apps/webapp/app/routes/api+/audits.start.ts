import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";

import { resolveAssetIdsForBulkOperation } from "~/modules/asset/bulk-operations-helper.server";
import { lastAuditDateAccessFor } from "~/modules/asset/last-audit-date-access.server";
import { resolveBookableListScope } from "~/modules/asset/list-scope.server";
import { CurrentSearchParamsSchema } from "~/modules/asset/utils.server";
import { getAssetIndexSettings } from "~/modules/asset-index-settings/service.server";
import {
  resolveAssetIdsForAudit,
  resolveAssetIdsForKitSelection,
  resolveAssetIdsForLocationSelection,
} from "~/modules/audit/context-helpers.server";
import { startAudit } from "~/modules/audit/start-audit.server";
import { getClientHint } from "~/utils/client-hints";
import { resolveUserFormatPrefsById } from "~/utils/date-format.server";
import { makeShelfError } from "~/utils/error";
import { assertIsPost, error, parseData, payload } from "~/utils/http.server";
import { ALL_SELECTED_KEY } from "~/utils/list";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

/**
 * Base schema with common audit fields shared across different entry points.
 * Used by both bulk selection (asset index) and context-based (location/kit/user) flows.
 */
export const BaseAuditSchema = z.object({
  name: z.string().trim().min(1, "Audit name is required"),
  description: z
    .string()
    .max(1000, "Description must be 1000 characters or fewer")
    .optional(),
  dueDate: z.string().optional(),
  assignee: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return undefined;
      try {
        const parsed = JSON.parse(val);
        return parsed.userId;
      } catch {
        return val;
      }
    }),
});

/**
 * Extended schema for the API endpoint. Supports two modes:
 * 1. Direct asset IDs - pass assetIds array (from asset index bulk selection)
 * 2. Context-based - pass contextType/contextId to fetch assets server-side
 */
export const StartAuditSchema = BaseAuditSchema.extend({
  // Asset IDs - required for bulk selection mode, optional for context mode
  assetIds: z.array(z.string()).optional(),
  // Context parameters - for starting audit from location/kit/user pages
  contextType: z.enum(["location", "kit", "user"]).optional(),
  contextId: z.string().optional(),
  contextName: z.string().optional(),
  // Location IDs - for the bulk "Create audit" action on the Locations index
  // (multi-select). May contain ALL_SELECTED_KEY when "select all" is active.
  locationIds: z.array(z.string()).optional(),
  // Kit IDs - for the bulk "Create audit" action on the Kits index
  // (multi-select). May contain ALL_SELECTED_KEY when "select all" is active.
  kitIds: z.array(z.string()).optional(),
  includeChildLocations: z.coerce.boolean().default(false),
}).refine(
  (data) => {
    // Must have assetIds, single-context params, a location multi-selection,
    // OR a kit multi-selection
    const hasAssetIds = data.assetIds && data.assetIds.length > 0;
    const hasContext = data.contextType && data.contextId;
    const hasLocationSelection =
      data.contextType === "location" &&
      !!data.locationIds &&
      data.locationIds.length > 0;
    const hasKitSelection =
      data.contextType === "kit" && !!data.kitIds && data.kitIds.length > 0;
    return hasAssetIds || hasContext || hasLocationSelection || hasKitSelection;
  },
  {
    message:
      "Provide assetIds, context parameters (contextType + contextId), a location selection (contextType=location + locationIds), or a kit selection (contextType=kit + kitIds).",
  }
);

export async function action({ request, context }: ActionFunctionArgs) {
  const { userId } = context.getSession();

  try {
    assertIsPost(request);

    const {
      organizationId,
      canUseBarcodes,
      role,
      access,
      currentOrganization,
    } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.audit,
      action: PermissionAction.create,
    });

    const formData = await request.formData();
    const hints = getClientHint(request);

    const {
      name,
      description,
      assetIds: directAssetIds,
      assignee,
      contextType,
      contextId,
      contextName,
      locationIds,
      kitIds,
      includeChildLocations,
      currentSearchParams,
    } = parseData(formData, StartAuditSchema.and(CurrentSearchParamsSchema), {
      additionalData: { organizationId, userId },
    });

    // Determine if we're selecting all asset rows across multiple pages
    const isSelectingAllAssets =
      directAssetIds && directAssetIds.includes(ALL_SELECTED_KEY);

    let assetIds: string[];

    // Resolve the acting user's timezone AT MOST ONCE. Both the select-all id
    // resolution and the due-date parse below can need it on the same submit;
    // memoizing means a select-all + due-date start issues a single lookup,
    // while a start needing neither issues none.
    let cachedTimeZone: string | undefined;
    const getUserTimeZone = async () => {
      if (cachedTimeZone === undefined) {
        cachedTimeZone = (await resolveUserFormatPrefsById(userId, hints))
          .timeZone;
      }
      return cachedTimeZone;
    };

    if (contextType === "location" && locationIds && locationIds.length > 0) {
      // Bulk "Create audit" from the Locations index (multi-select). Resolve
      // the union of assets across the selected locations server-side — handles
      // "select all" (honoring the list filter) and asserts explicit IDs.
      assetIds = await resolveAssetIdsForLocationSelection({
        organizationId,
        locationIds,
        currentSearchParams,
      });
    } else if (contextType === "kit" && kitIds && kitIds.length > 0) {
      // Bulk "Create audit" from the Kits index (multi-select). Resolve the
      // union of assets across the selected kits server-side — handles "select
      // all" (honoring the list filter) and asserts explicit IDs.
      assetIds = await resolveAssetIdsForKitSelection({
        organizationId,
        kitIds,
        currentSearchParams,
      });
    } else if (isSelectingAllAssets) {
      // When "Select All" is used, resolve IDs using bulk operation helper
      // which handles both simple and advanced filter modes
      const settings = await getAssetIndexSettings({
        userId,
        organizationId,
        canUseBarcodes,
        role,
      });

      // Acting user's timezone: the select-all set is resolved from the current
      // date filters, which must truncate the day in the user's tz (avoids an
      // off-by-one for non-UTC users).
      const timeZone = await getUserTimeZone();

      assetIds = await resolveAssetIdsForBulkOperation({
        assetIds: directAssetIds,
        organizationId,
        currentSearchParams,
        settings,
        timeZone,
        // Gated on `audit: create`, which neither BASE nor SELF_SERVICE holds —
        // unlike `audits.add-assets`, which is `audit: update` and does narrow.
        allowedTeamMemberIds: "all",
        lastAuditDateAccess: lastAuditDateAccessFor(
          access,
          currentOrganization
        ),
        bookableScope: resolveBookableListScope({ access, userId }),
      });
    } else {
      // Resolve asset IDs from either direct input or context
      assetIds = await resolveAssetIdsForAudit({
        organizationId,
        directAssetIds,
        contextType,
        contextId,
        contextName,
        includeChildLocations,
      });
    }

    const { sessionId, isAssignedToOther } = await startAudit({
      name,
      description,
      assetIds,
      assignee,
      // The raw form value, not the Zod-parsed one: `startAudit` parses the
      // wall clock in the acting user's timezone preference.
      dueDateString: formData.get("dueDate")?.toString(),
      userId,
      organizationId,
      hints,
      resolveTimeZone: getUserTimeZone,
    });

    // Someone else was assigned: land on the overview. Self-assigned or
    // unassigned: the creator is the auditor, so go straight to scanning.
    const redirectPath = isAssignedToOther ? "overview" : "scan";

    return data(
      payload({
        success: true,
        redirectTo: `/audits/${sessionId}/${redirectPath}`,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
