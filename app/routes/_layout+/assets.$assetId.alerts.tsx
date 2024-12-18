import type { Prisma } from "@prisma/client";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { z } from "zod";
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
import { getPaginatedAndFilterableReminders } from "~/modules/asset/service.server";
import { getDateTimeFormat } from "~/utils/client-hints";
import { makeShelfError } from "~/utils/error";
import { data, error, getParams } from "~/utils/http.server";
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

    return json(
      data({
        header,
        modelName,
        items: assetReminders,
        totalItems: totalReminders,
        page,
        perPage,
        totalPages,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, assetId });
    throw json(error(reason), { status: reason.status });
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
      <Td className="flex items-center">
        {item.teamMembers.map((teamMember) => (
          <TooltipProvider key={teamMember.id}>
            <Tooltip>
              <TooltipTrigger>
                <img
                  alt={teamMember.name}
                  className="-ml-1 size-6 rounded border border-white"
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
    </>
  );
}
