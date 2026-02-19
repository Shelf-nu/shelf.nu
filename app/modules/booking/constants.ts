import type { Prisma } from "@prisma/client";
import { TAG_WITH_COLOR_SELECT } from "../tag/constants";

/** Includes needed for booking to have all data required for emails */
export const BOOKING_INCLUDE_FOR_EMAIL = {
  custodianTeamMember: true,
  custodianUser: true,
  organization: {
    include: {
      owner: {
        select: { email: true },
      },
    },
  },
  _count: {
    select: { assets: true },
  },
};

/**
 * Extended include for reservation emails — adds minimal asset fields
 * for displaying booked items in the email.
 * Only used in reserveBooking(), NOT in other email flows.
 */
export const BOOKING_INCLUDE_FOR_RESERVATION_EMAIL = {
  ...BOOKING_INCLUDE_FOR_EMAIL,
  assets: {
    select: {
      id: true,
      title: true,
      mainImage: true,
      category: {
        select: {
          name: true,
        },
      },
    },
  },
} satisfies Prisma.BookingInclude;

/**
 * Type for a booking with assets for reservation email, inferred from Prisma include
 */
type BookingForReservationEmail = Prisma.BookingGetPayload<{
  include: typeof BOOKING_INCLUDE_FOR_RESERVATION_EMAIL;
}>;

/**
 * Type for assets as returned in reservation emails.
 * Inferred from the Prisma include to ensure type safety.
 */
export type ReservationEmailAsset =
  BookingForReservationEmail["assets"][number];

/** Common relations to include in a booking */
export const BOOKING_COMMON_INCLUDE = {
  custodianTeamMember: true,
  custodianUser: true,
  tags: TAG_WITH_COLOR_SELECT,
} as Prisma.BookingInclude;

export const BOOKING_WITH_ASSETS_INCLUDE = {
  ...BOOKING_COMMON_INCLUDE,
  assets: {
    select: {
      id: true,
      title: true,
      availableToBook: true,
      status: true,
      kitId: true,
      valuation: true,
      category: {
        select: {
          id: true,
          name: true,
          color: true,
        },
      },
      kit: {
        select: {
          name: true,
        },
      },
    },
    orderBy: [
      { status: "desc" }, // CHECKED_OUT (desc) comes before AVAILABLE (asc)
      { createdAt: "asc" }, // Then by creation order as fallback
    ],
  },
} satisfies Prisma.BookingInclude;

/**
 * Type for a booking with assets included, inferred from BOOKING_WITH_ASSETS_INCLUDE
 */
type BookingWithAssets = Prisma.BookingGetPayload<{
  include: typeof BOOKING_WITH_ASSETS_INCLUDE;
}>;

/**
 * Type for assets as returned by BOOKING_WITH_ASSETS_INCLUDE
 * Inferred from the Prisma include to ensure type safety
 */
export type BookingAsset = BookingWithAssets["assets"][number];

/**
 * This enum represents the types of different events that can be scheduled for a booking using PgBoss
 */
export enum BOOKING_SCHEDULER_EVENTS_ENUM {
  checkoutReminder = `booking-checkout-reminder`,
  checkinReminder = `booking-checkin-reminder`,
  overdueHandler = `booking-overdue-handler`,
}

/**
 * Sorting options available for booking assets
 */
export const BOOKING_ASSET_SORTING_OPTIONS = {
  status: "Status",
  title: "Name",
  category: "Category",
} as const;

export type BookingAssetSortingOption =
  keyof typeof BOOKING_ASSET_SORTING_OPTIONS;
