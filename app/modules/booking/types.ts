import type { Prisma } from "@prisma/client";

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
