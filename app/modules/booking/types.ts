import type { Prisma } from "@prisma/client";
import type { HeaderData } from "~/components/layout/header/types";
import type { ClientHint } from "~/utils/client-hints";
import type { ResponsePayload } from "~/utils/http.server";
import type { MergeInclude } from "~/utils/utils";
import type {
  BOOKING_SCHEDULER_EVENTS_ENUM,
  BOOKING_WITH_ASSETS_INCLUDE,
} from "./constants";

export type BookingWithExtraInclude<
  T extends Prisma.BookingInclude | undefined,
> = T extends Prisma.BookingInclude
  ? Prisma.BookingGetPayload<{
      include: MergeInclude<typeof BOOKING_WITH_ASSETS_INCLUDE, T>;
    }>
  : Prisma.BookingGetPayload<{ include: typeof BOOKING_WITH_ASSETS_INCLUDE }>;

export type BookingWithIncludes = Prisma.BookingGetPayload<{
  include: {
    assets: true;
    custodianTeamMember: true;
    custodianUser: true;
  };
}>;

export interface SchedulerData {
  id: string;
  hints: ClientHint;
  eventType: BOOKING_SCHEDULER_EVENTS_ENUM;
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

/**
 * Base interface for booking loader response
 */
interface BaseBookingLoaderResponse {
  showModal: boolean;
  header: HeaderData;
  bookings: any[];
  search: string | null;
  page: number;
  bookingCount: number;
  totalPages: number;
  perPage: number;
  modelName: {
    singular: string;
    plural: string;
  };
  ids?: string[];
  hints: any;
}

/**
 * Combined type for booking loader response that includes ResponsePayload requirements
 */
export type BookingLoaderResponse = BaseBookingLoaderResponse & ResponsePayload;
