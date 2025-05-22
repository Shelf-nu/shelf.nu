import FormRow from "~/components/forms/form-row";
import Input from "~/components/forms/input";
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
}) {
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
          disabled={disabled}
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
          disabled={disabled}
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
          Within this period the assets in this booking will be in custody and
          unavailable for other bookings.
        </p>
      </FormRow>
    </>
  );
}
