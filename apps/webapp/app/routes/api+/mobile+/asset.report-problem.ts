/**
 * POST /api/mobile/asset/report-problem
 *
 * The mobile twin of the web "Report a problem" action. Same grant
 * (`problemReport: create`), same text rule and same service, so the phone
 * accepts and refuses exactly what the web does.
 *
 * Body: `{ assetId: string, content: string }`
 * Returns: `{ notifiedCount: number }`, or `{ error: { message } }` with the
 * refusal's status.
 *
 * @see {@link file://../../../modules/problem-report/service.server.ts}
 * @see {@link file://../../_layout+/assets.$assetId.report-problem.tsx}
 */
import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { parseMobileBody } from "~/modules/api/mobile-body.server";
import { problemReportContentSchema } from "~/modules/problem-report/schema";
import { reportAssetProblem } from "~/modules/problem-report/service.server";
import { makeShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);

    await requireMobilePermission({
      userId: user.id,
      organizationId,
      entity: PermissionEntity.problemReport,
      action: PermissionAction.create,
    });

    const { assetId, content } = await parseMobileBody(
      z.object({
        assetId: z.string().min(1),
        content: problemReportContentSchema,
      }),
      request,
      "Assets"
    );

    const { notifiedCount } = await reportAssetProblem({
      assetId,
      organizationId,
      userId: user.id,
      content,
    });

    return data({ notifiedCount });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
