import type { Prisma } from "@prisma/client";
import type { bookingSchedulerEventsEnum } from "./constants";

export type BookingWithIncludes = Prisma.BookingGetPayload<{
  include: {
    assets: true;
    custodianTeamMember: true;
    custodianUser: true;
  };
}>;

export interface ClientHint {
  timeZone: string;
  locale: string;
}

export interface SchedulerData {
  id: string;
  hints: ClientHint;
  eventType: bookingSchedulerEventsEnum;
}

export type BookingUpdateIntent =
  | "save"
  | "reserve"
  | "delete"
  | "removeAsset"
  | "checkOut"
  | "checkIn"
  | "archive"
  | "cancel";

export type BookingWithCustodians = Prisma.BookingGetPayload<{
  include: {
    assets: true;
    from: true;
    to: true;
    custodianUser: true;
    custodianTeamMember: true;
  };
}>;
