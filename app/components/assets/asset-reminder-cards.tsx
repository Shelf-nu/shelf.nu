import { useLoaderData } from "@remix-run/react";
import { type loader } from "~/routes/_layout+/assets.$assetId.overview";
import { tw } from "~/utils/tw";
import ReminderTeamMembers from "../asset-reminder/reminder-team-members";
import { Button } from "../shared/button";
import When from "../when/when";

type AssetReminderCardsProps = {
  className?: string;
  style?: React.CSSProperties;
};

export function AssetReminderCards({
  className,
  style,
}: AssetReminderCardsProps) {
  const { asset, reminders } = useLoaderData<typeof loader>();

  if (!reminders.length) {
    return;
  }

  return (
    <div className={tw("rounded border bg-white", className)} style={style}>
      <div className="flex items-center justify-between gap-4 border-b px-4 py-3">
        <h5>Reminders</h5>

        <Button
          to={`/assets/${asset.id}/reminders`}
          variant="block-link-gray"
          className="!mt-0"
        >
          View all
        </Button>
      </div>

      {reminders.map((reminder) => {
        const slicedTeamMembers = reminder.teamMembers.slice(0, 10);
        const remainingTeamMembers =
          reminder.teamMembers.length - slicedTeamMembers.length;
        const isAlreadySent = new Date() > new Date(reminder.alertDateTime);

        return (
          <div key={reminder.id} className="border-b px-4 py-3">
            <h5 className="text-gray-700">{reminder.name}</h5>
            <p className="mb-2 text-xs text-gray-600">{reminder.message}</p>

            <ReminderTeamMembers
              imgClassName="rounded-full"
              teamMembers={slicedTeamMembers}
              isAlreadySent={isAlreadySent}
              extraContent={
                <When truthy={remainingTeamMembers > 0}>
                  <div className="flex size-6 items-center justify-center rounded-full border border-white bg-gray-100 text-xs font-medium">
                    +{remainingTeamMembers}
                  </div>
                </When>
              }
            />
          </div>
        );
      })}
    </div>
  );
}
