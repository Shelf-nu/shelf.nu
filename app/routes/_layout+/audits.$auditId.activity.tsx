import type { LoaderFunctionArgs } from "react-router";
import type { MetaFunction } from "react-router";
import { data, useLoaderData } from "react-router";
import { z } from "zod";

import { getAuditSessionDetails } from "~/modules/audit/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError } from "~/utils/error";
import { error, getParams, payload } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "Audit Activity" },
];

export const handle = {
  breadcrumb: () => "Activity",
};

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const { userId } = context.getSession();
  const { auditId } = getParams(params, z.object({ auditId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId, userOrganizations } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.audit,
      action: PermissionAction.read,
    });

    const { session } = await getAuditSessionDetails({
      id: auditId,
      organizationId,
      userOrganizations,
      request,
    });

    const header = { title: `${session.name} · Activity` };

    return data(
      payload({
        session,
        header,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, auditId, label: "Audit" });
    throw data(error(reason), { status: reason.status });
  }
}

export default function AuditActivity() {
  const { session } = useLoaderData<typeof loader>();

  return (
    <div className="mt-8">
      <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
        <h3 className="text-lg font-semibold text-gray-900">
          Activity tracking coming soon
        </h3>
        <p className="mt-2 text-sm text-gray-600">
          Audit activity tracking and history will be available here. This will
          include scan logs, status changes, and completion records for audit "
          <span className="font-medium">{session.name}</span>".
        </p>
      </div>
    </div>
  );
}
