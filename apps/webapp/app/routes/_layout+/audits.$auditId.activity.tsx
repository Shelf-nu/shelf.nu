import type { LoaderFunctionArgs } from "react-router";
import type { MetaFunction } from "react-router";
import { data } from "react-router";
import { z } from "zod";

import { AuditNotes } from "~/components/audit/notes";
import { NoPermissionsIcon } from "~/components/icons/library";
import TextualDivider from "~/components/shared/textual-divider";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { getAuditNotes } from "~/modules/audit/note-service.server";
import {
  getAuditSessionDetails,
  requireAuditAssigneeForBaseSelfService,
} from "~/modules/audit/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError } from "~/utils/error";
import { error, getParams, payload } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
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
    /**
     * Two-step gate, ordered deliberately — same reasoning as the asset
     * activity route.
     *
     * Step 1 is `audit:read` against the SELECTED workspace, because
     * `getAuditSessionDetails` uses `userOrganizations` to detect an audit
     * living in a different workspace of the same user and hand off to the
     * switch-workspace path. Gating on `auditNote:read` here would 403 that
     * deep link before the hand-off could happen.
     */
    const permissionResult = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.audit,
      action: PermissionAction.read,
    });

    const { organizationId, userOrganizations, isSelfServiceOrBase } =
      permissionResult;

    const { session } = await getAuditSessionDetails({
      id: auditId,
      organizationId,
      userOrganizations,
      request,
    });

    requireAuditAssigneeForBaseSelfService({
      audit: session,
      userId,
      isSelfServiceOrBase,
      auditId,
    });

    /**
     * Step 2: `auditNote:read`, enforced BEFORE any note is fetched, so the
     * notes never reach the payload of a user without the right to read them.
     *
     * Every role currently holds `auditNote:read`, so this is not a live
     * exposure today — it is the same shape as the asset gap, one permission
     * edit away from becoming one.
     */
    await requirePermission({
      userId,
      request,
      entity: PermissionEntity.auditNote,
      action: PermissionAction.read,
    });

    // Fetch audit notes
    const notes = await getAuditNotes({
      auditSessionId: auditId,
    });

    const header = { title: `${session.name} · Activity` };

    return data(
      payload({
        session: { ...session, notes },
        header,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, auditId, label: "Audit" });
    throw data(error(reason), { status: reason.status });
  }
}

export default function AuditActivity() {
  const { roles } = useUserRoleHelper();
  const canReadAuditNotes = userHasPermission({
    roles,
    entity: PermissionEntity.auditNote,
    action: PermissionAction.read,
  });

  return (
    <div className="w-full">
      {canReadAuditNotes ? (
        <>
          <TextualDivider text="Activity" className="mb-8 lg:hidden" />
          <AuditNotes />
        </>
      ) : (
        <div className="flex h-full flex-col justify-center">
          <div className="flex flex-col items-center justify-center  text-center">
            <div className="mb-4 inline-flex size-8 items-center justify-center  rounded-full bg-primary-100 p-2 text-primary-600">
              <NoPermissionsIcon />
            </div>
            <h5>Insufficient permissions</h5>
            <p>You are not allowed to view audit activity</p>
          </div>
        </div>
      )}
    </div>
  );
}
