import type { Prisma } from "@prisma/client";

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

/** Common relations to include in a booking */
export const BOOKING_COMMON_INCLUDE = {
  custodianTeamMember: true,
  custodianUser: true,
} as Prisma.BookingInclude;

export const BOOKING_WITH_ASSETS_INCLUDE = {
  ...BOOKING_COMMON_INCLUDE,
  assets: {
    select: {
      id: true,
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
      kit: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.BookingInclude;

/**
 * This enum represents the types of different events that can be scheduled for a booking using PgBoss
 */
export enum BOOKING_SCHEDULER_EVENTS_ENUM {
  checkoutReminder = `booking-checkout-reminder`,
  checkinReminder = `booking-checkin-reminder`,
  overdueHandler = `booking-overdue-handler`,
}
