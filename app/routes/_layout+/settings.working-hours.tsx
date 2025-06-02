import { OrganizationType } from "@prisma/client";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { ErrorContent } from "~/components/errors";
import type { HeaderData } from "~/components/layout/header/types";
import { Overrides } from "~/components/working-hours/overrides/overrides";
import { EnableWorkingHoursForm } from "~/components/working-hours/toggle-working-hours-form";
import { WeeklyScheduleForm } from "~/components/working-hours/weekly-schedule-form";
import {
  createWorkingHoursOverride,
  deleteWorkingHoursOverride,
  getWorkingHoursForOrganization,
  toggleWorkingHours,
  updateWorkingHoursSchedule,
} from "~/modules/working-hours/service.server";
import type { WeeklyScheduleJson } from "~/modules/working-hours/types";
import { parseWeeklyScheduleFromFormData } from "~/modules/working-hours/utils";
import {
  CreateOverrideFormSchema,
  WeeklyScheduleSchema,
  WorkingHoursToggleSchema,
} from "~/modules/working-hours/zod-utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { adjustDateToUTC } from "~/utils/date-fns";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ShelfError, makeShelfError } from "~/utils/error";
import { data, error, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId, currentOrganization } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.workingHours,
      action: PermissionAction.update,
    });

    if (currentOrganization.type === OrganizationType.PERSONAL) {
      throw new ShelfError({
        cause: null,
        title: "Not allowed",
        message:
          "You are not allowed to access working hours in a personal workspace.",
        label: "Settings",
      });
    }

    const workingHours = await getWorkingHoursForOrganization(organizationId);

    const header: HeaderData = {
      title: "Working hours",
      subHeading:
        "Manage your workspace's working hours. This will allow you to limit when bookings' start and end times and dates.",
    };

    return json(
      data({
        header,
        organization: currentOrganization,
        workingHours,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
}

export const handle = {
  breadcrumb: () => "Working hours",
};

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const ErrorBoundary = () => <ErrorContent />;

export type ActionData = typeof action;
export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.workingHours,
      action: PermissionAction.update,
    });

    const formData = await request.formData();

    // Get intent manually to avoid any parseData issues with numeric keys in updateSchedule form data
    const intent = formData.get("intent") as string;
    if (
      !intent ||
      ![
        "toggle",
        "updateSchedule",
        "createOverride",
        "deleteOverride",
      ].includes(intent)
    ) {
      throw new ShelfError({
        cause: null,
        message: "Invalid action",
        additionalData: { intent },
        label: "Working hours",
      });
    }

    switch (intent) {
      case "toggle": {
        // Only use parseData for simple fields without numeric keys
        const { enableWorkingHours } = parseData(
          formData,
          WorkingHoursToggleSchema
        );

        await toggleWorkingHours({
          organizationId,
          enabled: enableWorkingHours,
        });

        sendNotification({
          title: "Workspace updated",
          message: "Your workspace has been updated successfully",
          icon: { name: "success", variant: "success" },
          senderId: authSession.userId,
        });

        return json(data({ success: true }), { status: 200 });
      }

      case "updateSchedule": {
        // CRITICAL: Do NOT use parseData here - it will fail with numeric keys
        // Parse manually using your utility function
        const weeklyScheduleData = parseWeeklyScheduleFromFormData(formData);

        // Validate directly with Zod (bypass parseData completely)
        const validation = WeeklyScheduleSchema.safeParse(weeklyScheduleData);

        if (!validation.success) {
          throw new ShelfError({
            cause: validation.error,
            title: "Invalid Schedule",
            message: "Please check your working hours schedule for errors",
            additionalData: {
              userId,
              organizationId,
              validationErrors: validation.error.errors.reduce(
                (acc, error) => {
                  const field = error.path.join(".");
                  acc[field] = error.message;
                  return acc;
                },
                {} as Record<string, string>
              ),
            },
            label: "Working hours",
          });
        }

        await updateWorkingHoursSchedule({
          organizationId,
          weeklySchedule: validation.data,
        });

        sendNotification({
          title: "Schedule updated",
          message: "Your weekly schedule has been updated successfully",
          icon: { name: "success", variant: "success" },
          senderId: authSession.userId,
        });

        return json(data({ success: true }), { status: 200 });
      }
      case "createOverride": {
        // Extract timezone from form data first
        const timeZone = formData.get("timeZone") as string;
        if (!timeZone) {
          throw new ShelfError({
            cause: null,
            message: "Timezone is required",
            label: "Working hours",
          });
        }

        // Use parseData function following your standard pattern
        const validatedData = parseData(formData, CreateOverrideFormSchema);

        // Convert date from user timezone to UTC
        const utcDate = adjustDateToUTC(validatedData.date, timeZone);

        await createWorkingHoursOverride({
          organizationId,
          date: utcDate,
          isOpen: validatedData.isOpen,
          openTime: validatedData.openTime || undefined,
          closeTime: validatedData.closeTime || undefined,
          reason: validatedData.reason,
        });

        sendNotification({
          title: "Override created",
          message: "Working hours override has been created successfully",
          icon: { name: "success", variant: "success" },
          senderId: authSession.userId,
        });

        return json(data({ success: true }), { status: 200 });
      }

      case "deleteOverride": {
        const overrideId = formData.get("overrideId") as string;

        if (!overrideId) {
          throw new ShelfError({
            cause: null,
            message: "Override ID is required",
            additionalData: { intent },
            label: "Working hours",
          });
        }

        await deleteWorkingHoursOverride(overrideId);

        sendNotification({
          title: "Override deleted",
          message: "Your working hours override has been deleted successfully",
          icon: { name: "success", variant: "success" },
          senderId: authSession.userId,
        });

        return json(data({ success: true }), { status: 200 });
      }

      default: {
        throw new ShelfError({
          cause: null,
          message: "Invalid action",
          additionalData: { intent },
          label: "Working hours",
        });
      }
    }
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}
export default function GeneralPage() {
  const { header } = useLoaderData<typeof loader>();
  const { workingHours } = useLoaderData<typeof loader>();
  return (
    <>
      <EnableWorkingHoursForm enabled={workingHours.enabled} header={header} />
      {/* New weekly schedule form - only show if working hours are enabled */}
      {workingHours.enabled && (
        <WeeklyScheduleForm
          weeklySchedule={
            workingHours.weeklySchedule as unknown as WeeklyScheduleJson
          }
        />
      )}
      {/* New weekly schedule form - only show if working hours are enabled */}
      {workingHours.enabled && <Overrides overrides={workingHours.overrides} />}
    </>
  );
}
