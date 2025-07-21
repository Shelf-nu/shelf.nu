import FormRow from "~/components/forms/form-row";
import Input from "~/components/forms/input";
import { InfoBox } from "~/components/shared/info-box";
import { Spinner } from "~/components/shared/spinner";
import { TimeDisplay } from "~/components/shared/time-display";
import { WorkingHoursPreviewDialog } from "~/components/working-hours/working-hours-preview-dialog";
import type {
  useWorkingHours,
  UseWorkingHoursResult,
} from "~/hooks/use-working-hours";
import { dateForDateTimeInputValue } from "~/utils/date-fns";
import { tw } from "~/utils/tw";

export function DatesFields({
  startDate,
  startDateName,
  disabled,
  startDateError,
  setStartDate,
  endDate,
  endDateName,
  endDateError,
  setEndDate,
  isNewBooking,
  workingHoursData,
}: {
  startDate: string | undefined;
  startDateName: string;
  disabled: boolean;
  startDateError?: string;
  setStartDate?: React.Dispatch<React.SetStateAction<string>>;
  endDate: string | undefined;
  endDateName: string;
  endDateError?: string;
  setEndDate: React.Dispatch<React.SetStateAction<string>>;
  isNewBooking?: boolean;
  workingHoursData: NonNullable<ReturnType<typeof useWorkingHours>>;
}) {
  const { isLoading = true, error } = workingHoursData;
  const workingHoursDisabled = disabled || isLoading;

  return (
    <>
      <FormRow
        rowLabel="Start Date"
        className="mobile-styling-only border-b-0 pb-[10px] pt-0"
        required
      >
        <Input
          key={startDate}
          label="Start Date"
          type="datetime-local"
          hideLabel
          name={startDateName}
          disabled={workingHoursDisabled}
          error={startDateError}
          className="w-full"
          defaultValue={startDate}
          placeholder="Booking"
          required
          onChange={(event) => {
            // Update start date state to persist user's selection
            if (setStartDate) {
              setStartDate(event.target.value);
            }

            /**
             * When user changes the startDate and the new startDate is greater than the endDate
             * in that case, we have to update endDate to be the endDay date of startDate.
             */
            const newStartDate = new Date(event.target.value);
            if (isNewBooking && endDate && newStartDate > new Date(endDate)) {
              const newEndDate = dateForDateTimeInputValue(
                new Date(newStartDate.setHours(18, 0, 0))
              );
              setEndDate(newEndDate.substring(0, newEndDate.length - 3));
            }
          }}
        />
      </FormRow>
      <FormRow
        rowLabel="End Date"
        className="mobile-styling-only mb-2.5 border-b-0 p-0"
        required
      >
        <Input
          key={"end-date-input"}
          label="End Date"
          type="datetime-local"
          hideLabel
          name={endDateName}
          disabled={workingHoursDisabled}
          error={endDateError}
          className="w-full"
          placeholder="Booking"
          required
          value={endDate}
          onChange={(event) => {
            setEndDate(event.target.value);
          }}
        />

        <p className="text-[14px] text-gray-600">
          Within this period the assets in this booking will be checked out and
          unavailable for other bookings.
        </p>
      </FormRow>
      <WorkingHoursInfo
        workingHoursData={workingHoursData}
        loading={isLoading}
      />
      {error && (
        <p className="mt-1 text-sm text-orange-600">
          Working hours validation unavailable: {error}
        </p>
      )}
    </>
  );
}

export function WorkingHoursInfo({
  workingHoursData,
  loading,
  className,
}: {
  workingHoursData: UseWorkingHoursResult;
  loading: boolean;
  className?: string;
}) {
  if (loading) {
    return (
      <InfoBox className={tw("py-2", className)}>
        <div className="flex items-center gap-2">
          <div>Loading working hours</div>
          <Spinner className="mt-1 size-4" />
        </div>
      </InfoBox>
    );
  }

  const { workingHours, error } = workingHoursData;
  if (!workingHours) return null;

  // Get working days from weekly schedule
  const workingDays: string[] = [];
  const dayNames = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];

  const workingDaySchedules: Array<{
    day: string;
    openTime: string;
    closeTime: string;
  }> = [];

  Object.entries(workingHours.weeklySchedule).forEach(
    ([dayNumber, schedule]) => {
      if (schedule.isOpen && schedule.openTime && schedule.closeTime) {
        const dayName = dayNames[parseInt(dayNumber)];
        workingDays.push(dayName);
        workingDaySchedules.push({
          day: dayName,
          openTime: schedule.openTime,
          closeTime: schedule.closeTime,
        });
      }
    }
  );

  // Check if all working days have the same hours
  const hasUniformHours =
    workingDaySchedules.length > 0 &&
    workingDaySchedules.every(
      (schedule) =>
        schedule.openTime === workingDaySchedules[0].openTime &&
        schedule.closeTime === workingDaySchedules[0].closeTime
    );

  const shouldShowWorkingHoursInfo = workingHours?.enabled && !error;
  return shouldShowWorkingHoursInfo ? (
    <InfoBox className={tw("py-2", className)}>
      {loading ? (
        <div className="flex items-center gap-2">
          <div>Loading working hours</div>
          <Spinner className="mt-1 size-4" />
        </div>
      ) : (
        <div className="mt-1 text-sm text-gray-600">
          <p>
            <strong>Working days:</strong>{" "}
            {workingDays.length > 0 ? workingDays.join(", ") : "None"}
          </p>
          {hasUniformHours ? (
            <p>
              <strong>Working hours:</strong>{" "}
              <TimeDisplay time={workingDaySchedules[0].openTime} /> -{" "}
              <TimeDisplay time={workingDaySchedules[0].closeTime} />
            </p>
          ) : (
            <p>
              <strong>Working hours:</strong> Vary by day
            </p>
          )}
          {workingHours.overrides.length > 0 && (
            <p className="mt-1 text-xs text-gray-500">
              Special dates and holidays are also considered
            </p>
          )}
          <div className="shrink-0">
            <WorkingHoursPreviewDialog workingHoursData={workingHoursData} />
          </div>
        </div>
      )}
    </InfoBox>
  ) : null;
}
