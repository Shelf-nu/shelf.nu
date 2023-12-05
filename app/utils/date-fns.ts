export function getDifferenceInSeconds(
  dateLeft: Date,
  dateRight: Date
): number {
  const millisecondsDifference = Math.abs(
    dateLeft.getTime() - dateRight.getTime()
  );
  const secondsDifference = millisecondsDifference / 1000;
  return secondsDifference;
}

/** Prepares a date to be passed as default value for input with type `datetime-local` */
export const dateForDateTimeInputValue = (date: Date) => {
  const localDate = new Date(
    date.getTime() - date.getTimezoneOffset() * 60 * 1000
  );
  return localDate.toISOString().slice(0, 19);
};
