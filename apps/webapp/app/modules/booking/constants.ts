import type { Prisma } from "@prisma/client";
import { TAG_WITH_COLOR_SELECT } from "../tag/constants";

/** Includes needed for booking to have all data required for emails */
export const BOOKING_INCLUDE_FOR_EMAIL = {
  custodianTeamMember: true,
  custodianUser: true,
  // Include creator details so the notification resolver can add the
  // booking creator as a recipient when the org setting is enabled
  creator: {
    select: { id: true, email: true, firstName: true, lastName: true },
  },
  // Include per-booking notification recipients (team members explicitly
  // added to this booking) for the recipient resolver's step 6
  notificationRecipients: {
    select: {
      id: true,
      name: true,
      user: {
        select: { id: true, email: true, firstName: true, lastName: true },
      },
    },
  },
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

/** Max number of assets to display in booking email notifications */
export const BOOKING_EMAIL_ASSETS_DISPLAY_LIMIT = 10;

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
      // Asset-code resolution fields — see `app/modules/barcode/display.ts`
      // for the canonical select shape. Tight `take: 1` + narrow `select`
      // keeps query weight minimal even with hundreds of booking assets.
      sequentialId: true,
      preferredBarcodeId: true,
      qrCodes: { take: 1, select: { id: true } },
      barcodes: { select: { id: true, type: true, value: true } },
      // Tag names — searchable in-memory by filterBookingAssets (assets only).
      tags: { select: { name: true } },
      category: {
        select: {
          id: true,
          name: true,
          color: true,
        },
      },
      // Asset's own location — drives the Location column sort and search.
      location: {
        select: {
          id: true,
          name: true,
        },
      },
      kit: {
        select: {
          name: true,
          // Kit's own location + category — needed for kit-group location
          // sorting and kit-level search. Kits have no sequentialId/tags.
          location: {
            select: {
              id: true,
              name: true,
            },
          },
          category: {
            select: {
              name: true,
            },
          },
        },
      },
    },
    // Base fetch order. The rendered order is computed in-memory by the
    // consuming route (sortBookingAssets / groupAndSortAssetsByKit); this DB
    // order only acts as the stable tiebreaker fed into those sorts. Kept
    // identical to the historical default (CHECKED_OUT first, then creation
    // order) so the in-memory sorts receive the exact same input as before —
    // preserving the booking page's default ordering 1:1.
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
  autoArchiveHandler = `booking-auto-archive-handler`,
}

/**
 * Sorting options available for booking assets
 */
export const BOOKING_ASSET_SORTING_OPTIONS = {
  status: "Status",
  title: "Name",
  category: "Category",
  location: "Location",
} as const;

export type BookingAssetSortingOption =
  keyof typeof BOOKING_ASSET_SORTING_OPTIONS;
