import React, { useState } from "react";
import { CalendarDays, Clock, AlertCircle, Info } from "lucide-react";
import { Dialog, DialogPortal } from "~/components/layout/dialog";
import { DateS } from "~/components/shared/date";
import { TimeDisplay } from "~/components/shared/time-display";
import type { UseWorkingHoursResult } from "~/hooks/use-working-hours";
import {
  DAY_ABBREVIATIONS,
  DAY_NAMES,
} from "~/modules/working-hours/constants";
import type { WorkingHoursData } from "~/modules/working-hours/types";
import { tw } from "~/utils/tw";
import { Button } from "../shared/button";

// Check if date is upcoming (within next 30 days)
const isUpcoming = (dateString: string): boolean => {
  const date = new Date(dateString);
  const now = new Date();
  const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  return date >= now && date <= thirtyDaysFromNow;
};

interface WeeklyScheduleGridProps {
  weeklySchedule: WorkingHoursData["weeklySchedule"];
}

const WeeklyScheduleGrid = ({ weeklySchedule }: WeeklyScheduleGridProps) => (
  <div className="mb-6 grid grid-cols-7 gap-2">
    {([0, 1, 2, 3, 4, 5, 6] as const).map((dayIndex) => {
      const daySchedule = weeklySchedule[dayIndex.toString()];
      const isOpen = daySchedule?.isOpen || false;

      return (
        <div
          key={dayIndex}
          className={tw(
            "relative overflow-hidden border transition-all duration-200",
            isOpen
              ? "border-green-200 bg-gradient-to-b from-green-50 to-green-100 shadow-sm"
              : "border-gray-200 bg-gradient-to-b from-gray-50 to-gray-100"
          )}
        >
          {/* Day header */}
          <div
            className={tw(
              "border-b px-3 py-2 text-center",
              isOpen
                ? "border-green-200 bg-green-100"
                : "border-gray-200 bg-gray-100"
            )}
          >
            <div className="text-sm font-semibold text-gray-900">
              {DAY_ABBREVIATIONS[dayIndex]}
            </div>
            <div className="mt-0.5 text-xs text-gray-600">
              {DAY_NAMES[dayIndex].slice(0, 3)}
            </div>
          </div>

          {/* Schedule content */}
          <div className="flex min-h-[80px] flex-col justify-center px-3 py-4">
            {isOpen && daySchedule?.openTime && daySchedule?.closeTime ? (
              <>
                <div className="mb-2 flex items-center justify-center">
                  <Clock className="size-4 text-green-600" />
                </div>
                <div className="space-y-1 text-center">
                  <div className="text-xs font-medium text-gray-900">
                    <TimeDisplay time={daySchedule.openTime} />
                  </div>
                  <div className="text-xs text-gray-500">to</div>
                  <div className="text-xs font-medium text-gray-900">
                    <TimeDisplay time={daySchedule.closeTime} />
                  </div>
                </div>
              </>
            ) : (
              <div className="text-center">
                <div className="mx-auto mb-2 flex size-8 items-center justify-center rounded-full bg-gray-200">
                  <div className="h-0.5 w-3 rounded bg-gray-400"></div>
                </div>
                <div className="text-xs font-medium text-gray-500">Closed</div>
              </div>
            )}
          </div>
        </div>
      );
    })}
  </div>
);

interface OverridesSectionProps {
  overrides: WorkingHoursData["overrides"];
}

const OverridesSection = ({ overrides }: OverridesSectionProps) => {
  const upcomingOverrides = overrides
    .filter((override) => isUpcoming(override.date))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .slice(0, 5); // Show only next 5

  if (upcomingOverrides.length === 0) {
    return (
      <div className="py-6 text-center text-gray-500">
        <CalendarDays className="mx-auto mb-2 size-8 opacity-50" />
        <p className="text-sm">No upcoming schedule changes</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {upcomingOverrides.map((override) => (
        <div
          key={override.id}
          className={tw(
            "flex items-start rounded border p-4 py-2 transition-colors",
            override.isOpen
              ? "border border-blue-200 bg-blue-50"
              : "border border-red-200 bg-red-50"
          )}
        >
          <div
            className={tw(
              "mr-3 mt-0.5 flex size-8 items-center justify-center rounded-full",
              override.isOpen ? "bg-blue-100" : "bg-red-100"
            )}
          >
            {override.isOpen ? (
              <Clock className="size-4 text-blue-600" />
            ) : (
              <AlertCircle className="size-4 text-red-600" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center justify-between">
              <h4 className="text-sm font-semibold text-gray-900">
                <DateS
                  date={override.date}
                  localeOnly
                  options={{
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  }}
                />
              </h4>
              <span
                className={tw(
                  "inline-flex items-center rounded-full px-2 py-1 text-xs font-medium",
                  override.isOpen
                    ? "bg-blue-100 text-blue-800"
                    : "bg-red-100 text-red-800"
                )}
              >
                {override.isOpen ? "Modified Hours" : "Closed"}
              </span>
            </div>

            {override.isOpen && override.openTime && override.closeTime ? (
              <p className="mb-1 text-sm text-gray-700">
                <span className="font-medium">
                  <TimeDisplay time={override.openTime} /> -{" "}
                  <TimeDisplay time={override.closeTime} />
                </span>
              </p>
            ) : (
              <p className="mb-1 text-sm font-medium text-gray-700">
                Closed all day
              </p>
            )}

            {override.reason && (
              <p className="text-xs italic text-gray-600">{override.reason}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

export const WorkingHoursPreviewDialog = ({
  workingHoursData,
}: {
  workingHoursData: UseWorkingHoursResult;
}) => {
  const { workingHours, isLoading } = workingHoursData;
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  function handleOpenDialog() {
    setIsDialogOpen(true);
  }

  function handleCloseDialog() {
    setIsDialogOpen(false);
  }

  return (
    <>
      <Button
        variant="link-gray"
        onClick={handleOpenDialog}
        className={"mt-2 text-sm"}
        type={"button"}
      >
        View full working schedule
      </Button>
      <DialogPortal>
        <Dialog
          open={isDialogOpen}
          onClose={handleCloseDialog}
          className="w-full overflow-auto md:max-h-[85vh] md:w-[900px]"
          headerClassName="border-b"
          title={
            <div className="flex items-center space-x-3 pb-6">
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary-100">
                <CalendarDays className="size-5 text-primary-600" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900">
                  Working Hours Schedule
                </h2>
                <p className="text-sm text-gray-600">
                  Review operating hours and upcoming changes
                </p>
              </div>
            </div>
          }
        >
          <div className="p-6">
            {isLoading ? (
              <div className="py-12 text-center">
                <div className="animate-spin mx-auto mb-4 size-8 rounded-full border-2 border-blue-600 border-t-transparent" />
                <p className="text-gray-600">Loading working hours...</p>
              </div>
            ) : !workingHours?.enabled ? (
              <div className="py-12 text-center">
                <Info className="mx-auto mb-4 size-12 text-gray-400" />
                <h3 className="mb-2 text-lg font-medium text-gray-900">
                  Working Hours Not Configured
                </h3>
                <p className="text-gray-600">
                  This workspace doesn't have working hours restrictions. All
                  times are available for booking.
                </p>
              </div>
            ) : (
              <div className="space-y-8">
                {/* Weekly Schedule Section */}
                <div>
                  <div className="mb-4 flex items-center">
                    <h3 className="text-lg font-semibold text-gray-900">
                      Weekly Schedule
                    </h3>
                  </div>
                  <WeeklyScheduleGrid
                    weeklySchedule={workingHours.weeklySchedule}
                  />
                </div>

                {/* Overrides Section */}
                <div>
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-gray-900">
                      Upcoming Schedule Changes
                    </h3>
                    <span className="text-sm text-gray-500">Next 30 days</span>
                  </div>
                  <OverridesSection overrides={workingHours.overrides} />
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-gray-200 bg-gray-50 px-6 py-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-600">
                Booking times are validated against these working hours
              </p>
              <Button
                onClick={handleCloseDialog}
                variant="secondary"
                type={"button"}
              >
                Close
              </Button>
            </div>
          </div>
        </Dialog>
      </DialogPortal>
    </>
  );
};
