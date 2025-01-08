import type { Prisma } from "@prisma/client";
import { Link } from "@remix-run/react";
import colors from "tailwindcss/colors";
import type { ASSET_REMINDER_INCLUDE_FIELDS } from "~/modules/asset-reminder/fields";
import { resolveTeamMemberName } from "~/utils/user";
import { List } from "../list";
import { Badge } from "../shared/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../shared/tooltip";
import { Td, Th } from "../table";
import ActionsDropdown from "./actions-dropdown";
import When from "../when/when";

type RemindersTableProps = {
  hideAssetColumn?: boolean;
};

export default function RemindersTable({
  hideAssetColumn,
}: RemindersTableProps) {
  return (
    <List
      className="overflow-x-visible md:overflow-x-auto"
      ItemComponent={ListContent}
      headerChildren={
        <>
          <Th>Message</Th>
          <When truthy={!hideAssetColumn}>
            <Td>Asset</Td>
          </When>
          <Th>Alert Date</Th>
          <Th>Status</Th>
          <Th>Users</Th>
        </>
      }
      extraItemComponentProps={{ hideAssetColumn }}
    />
  );
}

function ListContent({
  item,
  extraProps,
}: {
  item: Prisma.AssetReminderGetPayload<{
    include: typeof ASSET_REMINDER_INCLUDE_FIELDS;
  }> & { displayDate: string };
  extraProps: { hideAssetColumn: boolean };
}) {
  const now = new Date();
  const status =
    now < new Date(item.alertDateTime) ? "Pending" : "Reminder sent";

  return (
    <>
      <Td className="md:min-w-60">{item.name}</Td>
      <Td className="max-w-62 md:max-w-96">{item.message}</Td>
      <When truthy={!extraProps.hideAssetColumn}>
        <Td>
          <Link
            className="hover:underline"
            to={`/assets/${item.asset.id}/overview`}
            target="_blank"
          >
            {item.asset.title}
          </Link>
        </Td>
      </When>
      <Td>{item.displayDate}</Td>
      <Td>
        <Badge
          color={
            status === "Pending" ? colors.yellow["500"] : colors.green["500"]
          }
        >
          {status}
        </Badge>
      </Td>
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
