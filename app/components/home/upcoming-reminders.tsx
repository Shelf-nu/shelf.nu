import { useLoaderData } from "react-router";
import type { loader } from "~/routes/_layout+/home";
import { ClickableTr } from "../dashboard/clickable-tr";
import { DashboardEmptyState } from "../dashboard/empty-state";
import { Button } from "../shared/button";

import { Table, Td } from "../table";

/** Format alert date: "Jan 15" or "Today, 3:00 PM" */
function formatAlertDate(date: string | Date): string {
  const d = new Date(date);
  const now = new Date();

  if (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  ) {
    return `Today, ${d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    })}`;
  }

  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function UpcomingReminders() {
  const { upcomingReminders } = useLoaderData<typeof loader>();

  return (
    <div className="flex h-full flex-col rounded border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b px-4 py-3 md:px-6">
        <span className="text-[14px] font-semibold text-gray-900">
          Upcoming reminders
        </span>
        <div className="flex items-center gap-2">
          <Button
            to="/reminders"
            variant="block-link-gray"
            className="!mt-0 text-xs"
          >
            View all
          </Button>
        </div>
      </div>
      {upcomingReminders.length > 0 ? (
        <Table className="flex-1">
          <tbody>
            {upcomingReminders.map((reminder: any) => (
              <ClickableTr
                key={reminder.id}
                to={`/assets/${reminder.asset.id}/reminders`}
              >
                <Td className="w-full">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <Button
                      to={`/assets/${reminder.asset.id}/reminders`}
                      variant="link"
                      className="truncate text-left text-sm font-medium text-gray-900 hover:text-gray-700"
                    >
                      {reminder.name}
                    </Button>
                    <span className="text-xs text-gray-500">
                      <span className="font-medium text-gray-700">
                        {reminder.asset.title}
                      </span>
                      {" · "}
                      {formatAlertDate(reminder.alertDateTime)}
                    </span>
                  </div>
                </Td>
              </ClickableTr>
            ))}
          </tbody>
        </Table>
      ) : (
        <div className="flex flex-1 items-center justify-center p-4">
          <DashboardEmptyState
            text="No upcoming reminders"
            subText="Asset reminders you set will appear here."
            ctaTo="/assets"
            ctaText="Go to assets"
          />
        </div>
      )}
    </div>
  );
}
