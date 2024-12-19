import type { Prisma } from "@prisma/client";
import { json } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import ActionsDropdown from "~/components/assets/reminders/actions-dropdown";
import { setReminderSchema } from "~/components/assets/reminders/set-or-edit-reminder-dialog";
import type { HeaderData } from "~/components/layout/header/types";
import { List } from "~/components/list";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/shared/tooltip";
import { Td, Th } from "~/components/table";
import type { ASSET_REMINDER_INCLUDE_FIELDS } from "~/modules/asset/fields";
import {
  deleteAssetReminder,
  editAssetReminder,
  getPaginatedAndFilterableReminders,
} from "~/modules/asset/service.server";
import { getPaginatedAndFilterableTeamMembers } from "~/modules/team-member/service.server";
import { checkExhaustiveSwitch } from "~/utils/check-exhaustive-switch";
import { getDateTimeFormat } from "~/utils/client-hints";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { data, error, getParams, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { resolveTeamMemberName } from "~/utils/user";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const userId = authSession.userId;

  const { assetId } = getParams(params, z.object({ assetId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.read,
    });

    const { reminders, totalReminders, page, perPage, totalPages } =
      await getPaginatedAndFilterableReminders({
        assetId,
        organizationId,
        request,
      });

    const header: HeaderData = { title: "Alerts" };
    const modelName = {
      signular: "alert",
      plural: "alerts",
    };

    const assetReminders = reminders.map((reminder) => ({
      ...reminder,
      displayDate: getDateTimeFormat(request, {
        dateStyle: "short",
        timeStyle: "short",
      }).format(reminder.alertDateTime),
    }));

    /** We need teamMembers in SetReminderForm */
    const { teamMembers, totalTeamMembers } =
      await getPaginatedAndFilterableTeamMembers({
        request,
        organizationId,
        where: { user: { isNot: null } },
      });

    return json(
      data({
        header,
        modelName,
        items: assetReminders,
        totalItems: totalReminders,
        page,
        perPage,
        totalPages,
        teamMembers,
        totalTeamMembers,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, assetId });
    throw json(error(reason), { status: reason.status });
  }
}

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const userId = authSession.userId;

  try {
    const formData = await request.formData();

    const { intent } = parseData(
      formData,
      z.object({ intent: z.enum(["edit-reminder", "delete-reminder"]) })
    );

    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.update,
    });

    switch (intent) {
      case "edit-reminder": {
        const payload = parseData(
          formData,
          setReminderSchema.extend({ id: z.string() })
        );

        await editAssetReminder({
          id: payload.id,
          name: payload.name,
          message: payload.message,
          alertDateTime: payload.alertDateTime,
          teamMembers: payload.teamMembers,
          organizationId,
        });

        sendNotification({
          title: "Reminder updated",
          message: "Your asset reminder has been updated successfully",
          icon: { name: "trash", variant: "error" },
          senderId: authSession.userId,
        });

        return json(data({ success: true }));
      }

      case "delete-reminder": {
        const { id } = parseData(formData, z.object({ id: z.string().min(1) }));

        await deleteAssetReminder({ id, organizationId });

        sendNotification({
          title: "Reminder deleted",
          message: "Your asset reminder has been deleted successfully",
          icon: { name: "trash", variant: "error" },
          senderId: authSession.userId,
        });

        return json(data({ success: true }));
      }

      default: {
        checkExhaustiveSwitch(intent);
        return json(data(null));
      }
    }
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}

export default function AssetAlerts() {
  return (
    <List
      className="overflow-x-visible md:overflow-x-auto"
      ItemComponent={ListContent}
      headerChildren={
        <>
          <Th>Message</Th>
          <Th>Alert Date</Th>
          <Th>Users</Th>
        </>
      }
    />
  );
}

function ListContent({
  item,
}: {
  item: Prisma.AssetReminderGetPayload<{
    include: typeof ASSET_REMINDER_INCLUDE_FIELDS;
  }> & { displayDate: string };
}) {
  return (
    <>
      <Td>{item.name}</Td>
      <Td className="max-w-62 md:max-w-96">{item.message}</Td>
      <Td>{item.displayDate}</Td>
      <Td className="flex shrink-0 items-center">
        {item.teamMembers.map((teamMember) => (
          <TooltipProvider key={teamMember.id}>
            <Tooltip>
              <TooltipTrigger>
                <img
                  alt={teamMember.name}
                  className="-ml-1 size-6 rounded border border-white object-cover"
                  src={
                    teamMember?.user?.profilePicture ??
                    "/static/images/default_pfp.jpg"
                  }
                />
              </TooltipTrigger>
              <TooltipContent side="top">
                {resolveTeamMemberName(teamMember)}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ))}
      </Td>
      <Td>
        <ActionsDropdown reminder={item} />
      </Td>
    </>
  );
}
