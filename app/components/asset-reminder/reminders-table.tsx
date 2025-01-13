import { useState } from "react";
import type { Prisma } from "@prisma/client";
import colors from "tailwindcss/colors";
import type { ASSET_REMINDER_INCLUDE_FIELDS } from "~/modules/asset-reminder/fields";
import { List } from "../list";
import ReminderTeamMembers from "./reminder-team-members";
import SetOrEditReminderDialog from "./set-or-edit-reminder-dialog";
import { Badge } from "../shared/badge";
import { Button } from "../shared/button";
import { Td, Th } from "../table";
import ActionsDropdown from "./actions-dropdown";
import When from "../when/when";

type RemindersTableProps = {
  isAssetReminderPage?: boolean;
};

export default function RemindersTable({
  isAssetReminderPage,
}: RemindersTableProps) {
  const [isReminderDialogOpen, setIsReminderDialogOpen] = useState(false);

  const emptyStateTitle = isAssetReminderPage
    ? "No reminders for this asset"
    : "No reminders created yet.";

  return (
    <>
      <List
        className="overflow-x-visible md:overflow-x-auto"
        ItemComponent={ListContent}
        customEmptyStateContent={{
          title: emptyStateTitle,
          text: (
            <p>
              What are you waiting for? Create your first{" "}
              {isAssetReminderPage ? (
                <Button
                  variant="link"
                  onClick={() => {
                    setIsReminderDialogOpen(true);
                  }}
                >
                  reminder
                </Button>
              ) : (
                "reminder"
              )}{" "}
              now!
            </p>
          ),
        }}
        headerChildren={
          <>
            <Th>Message</Th>
            <When truthy={!isAssetReminderPage}>
              <Td>Asset</Td>
            </When>
            <Th>Alert Date</Th>
            <Th>Status</Th>
            <Th>Users</Th>
          </>
        }
        extraItemComponentProps={{ isAssetReminderPage }}
      />

      <SetOrEditReminderDialog
        open={isReminderDialogOpen}
        onClose={() => {
          setIsReminderDialogOpen(false);
        }}
      />
    </>
  );
}

function ListContent({
  item,
  extraProps,
}: {
  item: Prisma.AssetReminderGetPayload<{
    include: typeof ASSET_REMINDER_INCLUDE_FIELDS;
  }> & { displayDate: string };
  extraProps: { isAssetReminderPage: boolean };
}) {
  const now = new Date();
  const status =
    now < new Date(item.alertDateTime) ? "Pending" : "Reminder sent";

  return (
    <>
      <Td className="md:min-w-60">{item.name}</Td>
      <Td className="max-w-62 md:max-w-96">{item.message}</Td>
      <When truthy={!extraProps.isAssetReminderPage}>
        <Td>
          <Button
            className="hover:underline"
            to={`/assets/${item.asset.id}/overview`}
            target="_blank"
            variant={"link-gray"}
          >
            {item.asset.title}
          </Button>
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
      <Td>
        <ReminderTeamMembers
          teamMembers={item.teamMembers}
          isAlreadySent={status === "Reminder sent"}
        />
      </Td>
      <Td>
        <ActionsDropdown reminder={item} />
      </Td>
    </>
  );
}