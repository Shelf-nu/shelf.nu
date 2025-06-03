import FormRow from "~/components/forms/form-row";
import Input from "~/components/forms/input";
import { InfoBox } from "~/components/shared/info-box";
import { Spinner } from "~/components/shared/spinner";
import { TimeDisplay } from "~/components/shared/time-display";
import type { useWorkingHours } from "~/hooks/use-working-hours";
import { dateForDateTimeInputValue } from "~/utils/date-fns";

export function DatesFields({
  startDate,
  startDateName,
  disabled,
  startDateError,
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
  endDate: string | undefined;
  endDateName: string;
  endDateError?: string;
  setEndDate: React.Dispatch<React.SetStateAction<string>>;
  isNewBooking?: boolean;
  workingHoursData: NonNullable<ReturnType<typeof useWorkingHours>>;
}) {
  const { workingHours, isLoading, error } = workingHoursData;

  const shouldShowWorkingHoursInfo = workingHours?.enabled && !error;
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
      {shouldShowWorkingHoursInfo && (
        <WorkingHoursInfo workingHours={workingHours} loading={isLoading} />
      )}
      {error && (
        <p className="mt-1 text-sm text-orange-600">
          Working hours validation unavailable: {error}
        </p>
      )}
    </>
  );
}

function WorkingHoursInfo({
  workingHours,
  loading,
}: {
  workingHours: NonNullable<ReturnType<typeof useWorkingHours>["workingHours"]>;
  loading: boolean;
}) {
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

  Object.entries(workingHours.weeklySchedule).forEach(
    ([dayNumber, schedule]) => {
      if (schedule.isOpen) {
        workingDays.push(dayNames[parseInt(dayNumber)]);
      }
    }
  );

  // Get typical working hours (from Monday if available, or first working day)
  const mondaySchedule = workingHours.weeklySchedule["1"];
  const firstWorkingDay = Object.values(workingHours.weeklySchedule).find(
    (day) => day.isOpen
  );
  const typicalHours = mondaySchedule?.isOpen
    ? mondaySchedule
    : firstWorkingDay;

  return (
    <InfoBox className="py-2">
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
          {typicalHours?.openTime && typicalHours?.closeTime && (
            <p>
              <strong>Working hours:</strong>{" "}
              <TimeDisplay time={typicalHours.openTime} /> -{" "}
              <TimeDisplay time={typicalHours.closeTime} />
            </p>
          )}
          {workingHours.overrides.length > 0 && (
            <p className="mt-1 text-xs text-gray-500">
              Special dates and holidays are also considered
            </p>
          )}
        </div>
      )}
    </InfoBox>
  );
}
