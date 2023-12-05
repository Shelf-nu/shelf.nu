import type { Prisma } from "@prisma/client";
import type { dateForDateTimeInputValue } from "~/utils/date-fns";

export type BookingWithIncludes = Prisma.BookingGetPayload<{
  include: {
    assets: true;
    custodianTeamMember: true;
    custodianUser: true;
  };
}>;

/** Extend it to add formatted dates */
export type ExtendedBooking = BookingWithIncludes & {
  fromForDateInput?: ReturnType<typeof dateForDateTimeInputValue>;
  toForDateInput?: ReturnType<typeof dateForDateTimeInputValue>;
};
