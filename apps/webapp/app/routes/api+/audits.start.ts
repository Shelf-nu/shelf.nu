import { DateTime } from "luxon";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";

import { db } from "~/database/db.server";
import { resolveAssetIdsForBulkOperation } from "~/modules/asset/bulk-operations-helper.server";
import { CurrentSearchParamsSchema } from "~/modules/asset/utils.server";
import { getAssetIndexSettings } from "~/modules/asset-index-settings/service.server";
import { AUDIT_SCHEDULER_EVENTS_ENUM } from "~/modules/audit/constants";
import { resolveAssetIdsForAudit } from "~/modules/audit/context-helpers.server";
import { sendAuditAssignedEmail } from "~/modules/audit/email-helpers";
import {
  createAuditSession,
  scheduleNextAuditJob,
} from "~/modules/audit/service.server";
import { getClientHint } from "~/utils/client-hints";
import { DATE_TIME_FORMAT } from "~/utils/constants";
import { badRequest, makeShelfError } from "~/utils/error";
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
  includeChildLocations: z.coerce.boolean().default(false),
}).refine(
  (data) => {
    // Must have either assetIds OR context params
    const hasAssetIds = data.assetIds && data.assetIds.length > 0;
    const hasContext = data.contextType && data.contextId;
    return hasAssetIds || hasContext;
  },
  {
    message: "Either assetIds or context parameters must be provided",
  }
);

export async function action({ request, context }: ActionFunctionArgs) {
  const { userId } = context.getSession();

  try {
    assertIsPost(request);

    const { organizationId, canUseBarcodes, role } = await requirePermission({
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
      includeChildLocations,
      currentSearchParams,
    } = parseData(formData, StartAuditSchema.and(CurrentSearchParamsSchema), {
      additionalData: { organizationId, userId },
    });

    // Determine if we're selecting all items across multiple pages
    const isSelectingAll =
      directAssetIds && directAssetIds.includes(ALL_SELECTED_KEY);

    let assetIds: string[];

    if (isSelectingAll) {
      // When "Select All" is used, resolve IDs using bulk operation helper
      // which handles both simple and advanced filter modes
      const settings = await getAssetIndexSettings({
        userId,
        organizationId,
        canUseBarcodes,
        role,
      });

      assetIds = await resolveAssetIdsForBulkOperation({
        assetIds: directAssetIds,
        organizationId,
        currentSearchParams,
        settings,
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

    const sanitizedDescription = description?.trim() || undefined;

    // Convert dueDate from user's local timezone to UTC
    // Get raw value from formData (not parsed Zod value) to ensure proper timezone handling
    const dueDateString = formData.get("dueDate")?.toString();
    const dueDateUTC = dueDateString
      ? DateTime.fromFormat(dueDateString, DATE_TIME_FORMAT, {
          zone: hints.timeZone,
        }).toJSDate()
      : undefined;
    if (dueDateUTC && dueDateUTC <= new Date()) {
      throw badRequest("Due date must be in the future.", {
        additionalData: {
          validationErrors: {
            dueDate: { message: "Due date must be in the future" },
          },
        },
      });
    }

    const { session } = await createAuditSession({
      name,
      description: sanitizedDescription,
      assetIds,
      organizationId,
      createdById: userId,
      assignee,
      dueDate: dueDateUTC,
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
            hints,
          });
        }
      }
    }

    // Schedule reminders if due date is set
    if (session.dueDate && session.dueDate > new Date()) {
      // Calculate when to send the first reminder (24h before due date)
      const when24h = new Date(session.dueDate.getTime() - 24 * 60 * 60 * 1000);

      // Only schedule if 24h reminder is in the future
      if (when24h > new Date()) {
        await scheduleNextAuditJob({
          data: {
            id: session.id,
            hints,
            eventType: AUDIT_SCHEDULER_EVENTS_ENUM.reminder24h,
          },
          when: when24h,
        });
      } else {
        // If less than 24h until due date, start with appropriate reminder
        const when4h = new Date(session.dueDate.getTime() - 4 * 60 * 60 * 1000);
        const when1h = new Date(session.dueDate.getTime() - 1 * 60 * 60 * 1000);

        if (when4h > new Date()) {
          await scheduleNextAuditJob({
            data: {
              id: session.id,
              hints,
              eventType: AUDIT_SCHEDULER_EVENTS_ENUM.reminder4h,
            },
            when: when4h,
          });
        } else if (when1h > new Date()) {
          await scheduleNextAuditJob({
            data: {
              id: session.id,
              hints,
              eventType: AUDIT_SCHEDULER_EVENTS_ENUM.reminder1h,
            },
            when: when1h,
          });
        } else {
          // Already past all reminders, schedule overdue notice
          await scheduleNextAuditJob({
            data: {
              id: session.id,
              hints,
              eventType: AUDIT_SCHEDULER_EVENTS_ENUM.overdueNotice,
            },
            when: session.dueDate,
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
