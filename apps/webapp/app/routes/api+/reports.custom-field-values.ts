/**
 * Report filter bar: the values one TEXT custom field holds.
 *
 * The "Custom field is value" picker calls this when the user opens a TEXT
 * field. A field's distinct values are an aggregate over every asset in the
 * workspace, so they are read here, once per opened field, instead of by the
 * report page's loader on every page, sort and timeframe change.
 *
 * Gated like the report page: `reports: read`, and a plan that includes
 * reports.
 *
 * @see {@link file://../../components/reports/filters/custom-field-filter.tsx}
 * @see {@link file://../../modules/reports/filters.server.ts}
 */

import { data } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { z } from "zod";

import { loadCustomFieldValues } from "~/modules/reports/filters.server";
import type { ReportCustomFieldValuesPayload } from "~/modules/reports/types";
import { makeShelfError } from "~/utils/error";
import { error, parseData, payload } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { assertUserCanUseReports } from "~/utils/subscription.server";

/**
 * Returns the distinct values of the TEXT custom field named by
 * `?customFieldId=`, most frequent first.
 *
 * @returns `{ customFieldId, values, hasMore }`; no values for a field
 *   outside the workspace
 * @throws {ShelfError} 403 when the caller lacks `reports: read` or the
 *   workspace's plan does not include reports; 400 without a field id
 */
export async function loader({ context, request }: LoaderFunctionArgs) {
  const { userId } = context.getSession();

  try {
    const { organizationId, organizations } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.reports,
      action: PermissionAction.read,
    });

    // Reports are part of the Plus and Team plans.
    await assertUserCanUseReports({ organizationId, organizations });

    const { customFieldId } = parseData(
      new URL(request.url).searchParams,
      z.object({ customFieldId: z.string().min(1) }),
      { shouldBeCaptured: false }
    );

    const values: ReportCustomFieldValuesPayload = {
      customFieldId,
      ...(await loadCustomFieldValues({ organizationId, customFieldId })),
    };
    return data(payload(values));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}
