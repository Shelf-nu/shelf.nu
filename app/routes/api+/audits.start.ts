import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";

import { BulkStartAuditSchema } from "~/components/assets/bulk-start-audit-dialog";
import { db } from "~/database/db.server";
import { sendAuditAssignedEmail } from "~/modules/audit/email-helpers";
import { createAuditSession } from "~/modules/audit/service.server";
import { makeShelfError } from "~/utils/error";
import { assertIsPost, error, parseData, payload } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function action({ request, context }: ActionFunctionArgs) {
  const { userId } = context.getSession();

  try {
    assertIsPost(request);

    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.audit,
      action: PermissionAction.create,
    });

    const formData = await request.formData();

    const { name, description, assetIds, assignee } = parseData(
      formData,
      BulkStartAuditSchema,
      {
        additionalData: { organizationId, userId },
      }
    );

    const sanitizedDescription = description?.trim() || undefined;

    const { session } = await createAuditSession({
      name,
      description: sanitizedDescription,
      assetIds,
      organizationId,
      createdById: userId,
      assignee,
    });

    // Send email notification if audit is assigned to someone other than the creator
    if (assignee && assignee !== userId) {
      // Fetch full audit details for email
      const auditForEmail = await db.auditSession.findUnique({
        where: { id: session.id },
        include: {
          createdBy: {
            select: {
              firstName: true,
              lastName: true,
            },
          },
          organization: {
            include: {
              owner: {
                select: { email: true },
              },
            },
          },
          _count: {
            select: { assets: true },
          },
          assignments: {
            include: {
              user: {
                select: {
                  email: true,
                  firstName: true,
                  lastName: true,
                },
              },
            },
          },
        },
      });

      if (auditForEmail) {
        const assigneeUser = auditForEmail.assignments.find(
          (a: { userId: string }) => a.userId === assignee
        );

        if (assigneeUser?.user.email) {
          const assigneeName = `${assigneeUser.user.firstName || "Unknown"} ${
            assigneeUser.user.lastName || "User"
          }`;

          // Send async email (don't await to avoid blocking response)
          void sendAuditAssignedEmail({
            audit: auditForEmail,
            assigneeEmail: assigneeUser.user.email,
            assigneeName,
          });
        }
      }
    }

    // If assigned to someone else, redirect to overview page
    // If assigned to self or no assignee, redirect to scan page
    const isAssignedToOther = assignee && assignee !== userId;
    const redirectPath = isAssignedToOther ? "overview" : "scan";

    return data(
      payload({
        success: true,
        redirectTo: `/audits/${session.id}/${redirectPath}`,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
