import { useState } from "react";
import type { Prisma } from "@prisma/client";
import { RepeatIcon } from "lucide-react";
import { useParams } from "react-router";
import colors from "tailwindcss/colors";
import type { ASSET_REMINDER_INCLUDE_FIELDS } from "~/modules/asset-reminder/fields";
import { describeRecurrence } from "~/modules/asset-reminder/recurrence";
import { List } from "../list";
import ReminderTeamMembers from "./reminder-team-members";
import SetOrEditReminderDialog from "./set-or-edit-reminder-dialog";
import { ListContentWrapper } from "../list/content-wrapper";
import { Filters } from "../list/filters";
import { SortBy } from "../list/filters/sort-by";
import { Badge } from "../shared/badge";
import { Button } from "../shared/button";
import { DateS } from "../shared/date";
import { Td, Th } from "../table";
import ActionsDropdown from "./actions-dropdown";
import When from "../when/when";

type RemindersTableProps = {
  isAssetReminderPage?: boolean;
};

export const REMINDERS_SORTING_OPTIONS = {
  name: "Name",
  alertDateTime: "Alert Time",
  createdAt: "Date Created",
  updatedAt: "Date Updated",
} as const;

export default function RemindersTable({
  isAssetReminderPage,
}: RemindersTableProps) {
  const [isReminderDialogOpen, setIsReminderDialogOpen] = useState(false);
  const { assetId } = useParams<{ assetId: string }>();

  const emptyStateTitle = isAssetReminderPage
    ? "No reminders for this asset"
    : "No reminders created yet.";

  return (
    <ListContentWrapper className="mb-4">
      <Filters
        slots={{
          "right-of-search": (
            <SortBy
              sortingOptions={REMINDERS_SORTING_OPTIONS}
              defaultSortingBy="alertDateTime"
            />
          ),
        }}
      />

      <List
        className="overflow-x-hidden"
        ItemComponent={ListContent}
        customEmptyStateContent={{
          title: emptyStateTitle,
          text: (
            <p>
              What are you waiting for? Create your first{" "}
              {isAssetReminderPage ? (
                <Button
                  type="button"
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
        action={isAssetReminderPage ? `/assets/${assetId}` : undefined}
        open={isReminderDialogOpen}
        onClose={() => {
          setIsReminderDialogOpen(false);
        }}
      />
    </ListContentWrapper>
  );
}

function ListContent({
  item,
  extraProps,
}: {
  item: Prisma.AssetReminderGetPayload<{
    include: typeof ASSET_REMINDER_INCLUDE_FIELDS;
  }>;
  extraProps: { isAssetReminderPage: boolean };
}) {
  const now = new Date();
  /**
   * For an ACTIVE recurring reminder, alertDateTime is always the next
   * occurrence (the worker advances it in place), so "Pending" stays
   * correct; once a series ends the date stays in the past and the badge
   * flips to "Reminder sent" — same rule as one-shots.
   */
  const status =
    now < new Date(item.alertDateTime) ? "Pending" : "Reminder sent";
  const recurrenceLabel = describeRecurrence(item);

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
      <Td>
        <DateS date={item.alertDateTime} includeTime />
        {recurrenceLabel ? (
          <span className="mt-0.5 flex items-center gap-1 text-xs text-gray-500">
            <RepeatIcon className="size-3" aria-hidden="true" />
            {recurrenceLabel}
          </span>
        ) : null}
      </Td>
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
