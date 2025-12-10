import { AuditStatus, OrganizationRoles } from "@prisma/client";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { data, useLoaderData, Outlet, useMatches, Form } from "react-router";
import { z } from "zod";
import { ErrorContent } from "~/components/errors";
import Header from "~/components/layout/header";
import HorizontalTabs from "~/components/layout/horizontal-tabs";
import { Button } from "~/components/shared/button";
import { db } from "~/database/db.server";
import { getAuditSessionDetails } from "~/modules/audit/service.server";
import type { RouteHandleWithName } from "~/modules/types";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError, ShelfError } from "~/utils/error";
import { error, getParams, payload } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

const label = "Audit";

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  {
    title: data ? appendToMetaTitle(data.session.name) : "Audit",
  },
];

export const handle = {
  breadcrumb: () => "single",
};

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const { userId } = context.getSession();
  const { auditId } = getParams(params, z.object({ auditId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const permissionResult = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.audit,
      action: PermissionAction.read,
    });

    const { organizationId, userOrganizations } = permissionResult;

    const { session } = await getAuditSessionDetails({
      id: auditId,
      organizationId,
      userOrganizations,
      request,
    });

    // Calculate stats for dynamic button text
    const scanCount = await db.auditScan.count({
      where: { auditSessionId: auditId },
    });
    const hasScans = scanCount > 0;

    const rolesForOrg = userOrganizations.find(
      (org) => org.organization.id === organizationId
    )?.roles;

    const isAdminOrOwner = rolesForOrg
      ? rolesForOrg.includes(OrganizationRoles.ADMIN) ||
        rolesForOrg.includes(OrganizationRoles.OWNER)
      : false;

    if (!isAdminOrOwner) {
      const isAssignee = session.assignments.some(
        (assignment) => assignment.userId === userId
      );

      if (!isAssignee) {
        throw new ShelfError({
          cause: null,
          message: "You are not assigned to this audit.",
          additionalData: { auditId, userId },
          status: 403,
          label,
        });
      }
    }
    const header = { title: `${session.name} · Overview` };

    return data(
      payload({
        header,
        session,
        isAdminOrOwner,
        hasScans,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, auditId });
    throw data(error(reason), { status: reason.status });
  }
}

export default function AuditDetailsPage() {
  const { session, isAdminOrOwner, hasScans } = useLoaderData<typeof loader>();

  const isCompleted = session.status === AuditStatus.COMPLETED;
  const items = [
    { to: "overview", content: "Overview" },
    { to: "activity", content: "Activity" },

    // TODO: Add activity tab once permission entity is defined
    // ...(userHasPermission({
    //   roles,
    //   entity: PermissionEntity.note,
    //   action: PermissionAction.read,
    // })
    //   ? [{ to: "activity", content: "Activity" }]
    //   : []),
  ];

  const matches = useMatches();
  const currentRoute: RouteHandleWithName = matches[matches.length - 1];

  /**
   * When we are on the audit.scan route, we render just the outlet without header/tabs.U
   * On other routes, we render the full layout with header and tabs.
   */
  const shouldRenderFullOutlet = currentRoute?.handle?.name === "audit.scan";

  return shouldRenderFullOutlet ? (
    <Outlet />
  ) : (
    <div className="relative">
      <Header
        title={session.name}
        subHeading={
          session.description ? (
            <div className="mt-1">{session.description}</div>
          ) : undefined
        }
      >
        {/* Action Buttons */}
        <div className="flex flex-wrap gap-2">
          {!isCompleted && (
            <Button
              to={`/audits/${session.id}/scan`}
              variant={"secondary"}
              type={"button"}
            >
              {hasScans ? "Continue scanning" : "Start scanning"}
            </Button>
          )}

          {!isCompleted && isAdminOrOwner && (
            <Form method="post">
              <input type="hidden" name="intent" value="complete-audit" />
              <Button type="submit" disabled={!hasScans} variant="primary">
                Complete audit
              </Button>
            </Form>
          )}
        </div>
      </Header>
      <HorizontalTabs items={items} />
      <div>
        <Outlet />
      </div>
    </div>
  );
}

export const ErrorBoundary = () => <ErrorContent />;
