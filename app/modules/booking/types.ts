import type { Prisma } from "@prisma/client";
import type { dateForDateTimeInputValue } from "~/utils/date-fns";

export type BookingWithIncludes = Prisma.BookingGetPayload<{
  include: {
    assets: true;
    custodianTeamMember: true;
    custodianUser: true;
  };
}>;

export interface SchedulerData {
  id: string;
}
