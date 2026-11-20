/**
 * Report a problem with an asset (web).
 *
 * The action behind the "Report a problem" dialog in the asset page's Actions
 * menu. Every role holds `problemReport: create`; the asset rules (the member
 * can open it, it is not archived) and the email live in the shared service,
 * which the mobile route calls too.
 *
 * @see {@link file://../../modules/problem-report/service.server.ts}
 * @see {@link file://../../components/assets/report-problem-dialog.tsx}
 * @see {@link file://../api+/mobile+/asset.report-problem.ts}
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { z } from "zod";
import { ProblemReportFormSchema } from "~/modules/problem-report/schema";
import { reportAssetProblem } from "~/modules/problem-report/service.server";
import { makeShelfError } from "~/utils/error";
import { error, getParams, parseData, payload } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

/** There is no page here: the dialog lives on the asset page. */
export function loader({ params }: LoaderFunctionArgs) {
  const { assetId } = getParams(params, z.object({ assetId: z.string() }));

  return redirect(`/assets/${assetId}`);
}

/**
 * Saves the report on the asset and emails the people who run the workspace.
 *
 * @returns `{ emailed }` on success (whether anyone was emailed, never how
 *   many: that would tell a member without access to the team list how many
 *   people run the workspace), or the refusal with its status
 */
export async function action({ context, request, params }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { assetId } = getParams(params, z.object({ assetId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId, userOrganizations } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.problemReport,
      action: PermissionAction.create,
    });

    const { content } = parseData(
      await request.formData(),
      ProblemReportFormSchema,
      { additionalData: { userId, assetId }, shouldBeCaptured: false }
    );

    const { notifiedCount } = await reportAssetProblem({
      assetId,
      organizationId,
      userId,
      content,
      userOrganizations,
      request,
    });

    return payload({ emailed: notifiedCount > 0 });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, assetId });
    return data(error(reason), { status: reason.status });
  }
}
