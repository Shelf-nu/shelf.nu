import type { Booking, Asset, TeamMember, User, Tag } from "@shelf/database";
import type { HeaderData } from "~/components/layout/header/types";
import type { ClientHint } from "~/utils/client-hints";
import type { ResponsePayload } from "~/utils/http.server";
import type { BOOKING_SCHEDULER_EVENTS_ENUM } from "./constants";

export type BookingWithExtraInclude<
  T extends Record<string, unknown> | undefined = undefined,
> = Booking & {
  custodianTeamMember: TeamMember | null;
  custodianUser: User | null;
  tags: Pick<Tag, "id" | "name" | "color">[];
  assets: {
    id: string;
    title: string;
    availableToBook: boolean;
    status: string;
    kitId: string | null;
    valuation: number | null;
    category: { id: string; name: string; color: string } | null;
    kit: { name: string } | null;
  }[];
} & (T extends Record<string, unknown> ? Record<string, unknown> : {});

export type BookingWithIncludes = Booking & {
  assets: Asset[];
  custodianTeamMember: TeamMember | null;
  custodianUser: User | null;
};

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

export type BookingWithCustodians = Booking & {
  assets: Asset[];
  custodianUser: User | null;
  custodianTeamMember: TeamMember | null;
};

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

/**
 * Minimum type for clashing bookings
 * This is used to represent bookings that clash with the current booking when extending or modifying a booking.
 */
export type ClashingBooking = Pick<Booking, "id" | "name">;
