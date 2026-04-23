import { AuditStatus, OrganizationRoles } from "@prisma/client";
import { DateTime } from "luxon";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
  LinksFunction,
} from "react-router";
import {
  data,
  redirect,
  useLoaderData,
  Outlet,
  useMatches,
} from "react-router";
import { z } from "zod";
import { ActionsDropdown } from "~/components/audit/actions-dropdown";
import CompleteAuditDialog from "~/components/audit/complete-audit-dialog";
import { EditAuditSchema } from "~/components/audit/edit-audit-dialog";
import { ErrorContent } from "~/components/errors";
import Header from "~/components/layout/header";
import HorizontalTabs from "~/components/layout/horizontal-tabs";
import { Button } from "~/components/shared/button";
import { db } from "~/database/db.server";
import { completeAuditWithImages } from "~/modules/audit/complete-audit-with-images.server";
import {
  getAuditSessionDetails,
  updateAuditSession,
  cancelAuditSession,
  archiveAuditSession,
  deleteAuditSession,
  requireAuditAssignee,
} from "~/modules/audit/service.server";
import type { RouteHandleWithName } from "~/modules/types";
import actionsCss from "~/styles/actions-dropdown.css?url";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { getClientHint } from "~/utils/client-hints";
import { DATE_TIME_FORMAT } from "~/utils/constants";
import { makeShelfError, ShelfError } from "~/utils/error";
import { error, getParams, payload } from "~/utils/http.server";
import { parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

const label = "Audit";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: actionsCss },
];

export async function action({ context, request, params }: ActionFunctionArgs) {
  const { userId } = context.getSession();
  const { auditId } = getParams(params, z.object({ auditId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const formData = await request.clone().formData();
    const intent = formData.get("intent");

    // Parse the intent first and derive the initial permission from it so
    // delete-only callers aren't blocked by an `update` gate that isn't
    // relevant to their action. (Today every delete-capable role also has
    // update, but that alignment is not a guarantee we should lean on.)
    const initialAction =
      intent === "delete-audit"
        ? PermissionAction.delete
        : PermissionAction.update;

    const { organizationId, isSelfServiceOrBase } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.audit,
      action: initialAction,
    });

    if (intent === "edit-audit") {
      const parsedData = parseData(formData, EditAuditSchema);
      const hints = getClientHint(request);

      // Parse due date using Luxon (same pattern as create audit)
      const dueDateString = formData.get("dueDate")?.toString();
      const dueDateUTC = dueDateString
        ? DateTime.fromFormat(dueDateString, DATE_TIME_FORMAT, {
            zone: hints.timeZone,
          }).toJSDate()
        : null;

      // Parse assignee from JSON (same pattern as create audit)
      let assigneeUserId: string | null = null;
      if (parsedData.assignee) {
        try {
          const parsed = JSON.parse(parsedData.assignee);
          assigneeUserId = parsed.userId || null;
        } catch {
          assigneeUserId = parsedData.assignee || null;
        }
      }

      await updateAuditSession({
        id: auditId,
        organizationId,
        userId,
        data: {
          name: parsedData.name,
          description: parsedData.description || null,
          dueDate: dueDateUTC,
          assigneeUserId,
        },
      });

      return payload({ success: true });
    }

    if (intent === "complete-audit") {
      // Only assignees can complete the audit
      // Exception: if audit has no assignees, admins/owners can complete
      await requireAuditAssignee({
        auditSessionId: auditId,
        organizationId,
        userId,
        request,
        isSelfServiceOrBase,
      });

      await completeAuditWithImages({
        request,
        auditSessionId: auditId,
        organizationId,
        userId,
      });

      return payload({ success: true });
    }

    if (intent === "cancel-audit") {
      const hints = getClientHint(request);
      await cancelAuditSession({
        auditSessionId: auditId,
        organizationId,
        userId,
        hints,
      });

      return payload({ success: true });
    }

    if (intent === "archive-audit") {
      // Archiving requires the explicit "archive" permission.
      // ADMIN/OWNER have it; BASE/SELF_SERVICE do not.
      await requirePermission({
        userId,
        request,
        entity: PermissionEntity.audit,
        action: PermissionAction.archive,
      });

      // Only admin/owner can archive — UI gates this, but enforce server-side
      // to prevent direct POST bypass by self-service/base roles
      if (isSelfServiceOrBase) {
        throw new ShelfError({
          cause: null,
          message: "You do not have permission to archive audits.",
          additionalData: { userId, auditId },
          label,
          status: 403,
        });
      }

      await archiveAuditSession({
        auditSessionId: auditId,
        organizationId,
        userId,
      });

      return payload({ success: true });
    }

    if (intent === "delete-audit") {
      // Outer requirePermission already gated on PermissionAction.delete
      // for this intent — no redundant inner re-check.

      // UI hides the button for self-service/base, but enforce server-side
      // to prevent direct POST bypass.
      if (isSelfServiceOrBase) {
        throw new ShelfError({
          cause: null,
          message: "You do not have permission to delete audits.",
          additionalData: { userId, auditId },
          label,
          status: 403,
        });
      }

      const { confirmation } = parseData(
        formData,
        z.object({ confirmation: z.string().min(1) })
      );

      // Name-match verification lives inside deleteAuditSession — it
      // re-reads the audit for existence/status anyway, so folding the
      // compare into the same query avoids a second round-trip and keeps
      // the "never trust client-supplied names" guarantee in one place.
      await deleteAuditSession({
        auditSessionId: auditId,
        organizationId,
        userId,
        expectedName: confirmation,
      });

      // Audit no longer exists — return the redirect so React Router
      // navigates. `throw redirect(...)` here would be caught by the
      // surrounding try/catch and turned into an error JSON response.
      return redirect("/audits");
    }

    throw new ShelfError({
      cause: null,
      message: "Invalid action intent",
      additionalData: { intent },
      label,
      status: 400,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, auditId });
    return data(error(reason), { status: reason.status });
  }
}

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

    const stats = {
      expectedCount: session.expectedAssetCount,
      foundCount: session.foundAssetCount,
      missingCount: session.missingAssetCount,
      unexpectedCount: session.unexpectedAssetCount,
    };

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
          title: "Access denied",
          message: "You are not assigned to this audit.",
          additionalData: { auditId, userId },
          status: 403,
          label,
        });
      }
    }
    const header = { title: `${session.name} · Overview` };

    // Fetch team members for audit assignment (used in edit dialog)
    const teamMembers = await db.teamMember.findMany({
      where: {
        organizationId,
        deletedAt: null,
        userId: { not: null }, // Only team members with user accounts
      },
      select: {
        id: true,
        name: true,
        userId: true,
      },
      orderBy: { name: "asc" },
    });

    return data(
      payload({
        header,
        session,
        isAdminOrOwner,
        hasScans,
        stats,
        userId,
        teamMembers,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, auditId });
    throw data(error(reason), { status: reason.status });
  }
}

export default function AuditDetailsPage() {
  const { session, isAdminOrOwner, hasScans, stats, userId } =
    useLoaderData<typeof loader>();

  const isCompleted = session.status === AuditStatus.COMPLETED;
  const isCancelled = session.status === AuditStatus.CANCELLED;
  const isArchived = session.status === AuditStatus.ARCHIVED;
  const isCreator = session.createdById === userId;

  // Check if current user is assigned to this audit
  const isAssignee = session.assignments.some(
    (assignment) => assignment.userId === userId
  );

  // Allow admin/owner to scan/complete if audit has no assignees
  const hasNoAssignees = session.assignments.length === 0;
  const canScanAndComplete = isAssignee || (isAdminOrOwner && hasNoAssignees);

  const items = [
    { to: "overview", content: "Overview" },
    { to: "activity", content: "Activity" },
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
          {/* Show actions dropdown to anyone who can view the audit (for PDF download) */}
          {(isAdminOrOwner || isCreator || isAssignee) && <ActionsDropdown />}

          {!isCompleted &&
            !isCancelled &&
            !isArchived &&
            canScanAndComplete && (
              <Button
                to={`/audits/${session.id}/scan`}
                variant={"secondary"}
                type={"button"}
              >
                {hasScans ? "Continue scanning" : "Start scanning"}
              </Button>
            )}

          {!isCompleted &&
            !isCancelled &&
            !isArchived &&
            canScanAndComplete && (
              <CompleteAuditDialog
                disabled={!hasScans}
                auditName={session.name}
                stats={stats}
              />
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
