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
    select: { bookingAssets: true },
  },
};

/**
 * Extended include for reservation emails — adds minimal asset fields
 * (via the BookingAsset pivot) for displaying booked items in the email.
 * Only used in reserveBooking(), NOT in other email flows.
 *
 * Also pulls `modelRequests` (Book-by-Model intent rows) with the
 * related `assetModel` so the reservation email can render a
 * "Requested models" section alongside the booked items list.
 */
export const BOOKING_INCLUDE_FOR_RESERVATION_EMAIL = {
  ...BOOKING_INCLUDE_FOR_EMAIL,
  bookingAssets: {
    include: {
      asset: {
        select: {
          id: true,
          title: true,
          type: true,
          category: {
            select: {
              name: true,
            },
          },
        },
      },
    },
  },
  modelRequests: {
    include: {
      assetModel: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
} satisfies Prisma.BookingInclude;

/**
 * Type for a booking with bookingAssets for reservation email, inferred from Prisma include
 */
type BookingForReservationEmail = Prisma.BookingGetPayload<{
  include: typeof BOOKING_INCLUDE_FOR_RESERVATION_EMAIL;
}>;

/**
 * Type for a single BookingAsset pivot row as returned in reservation emails.
 * Inferred from the Prisma include to ensure type safety.
 */
export type ReservationEmailAsset =
  BookingForReservationEmail["bookingAssets"][number];

/**
 * Type for a single outstanding `BookingModelRequest` row as returned
 * in reservation emails (Book-by-Model). Inferred from the Prisma
 * include so the email renderer can rely on `assetModel.name` without
 * restating the shape.
 */
export type ReservationEmailModelRequest =
  BookingForReservationEmail["modelRequests"][number];

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
  bookingAssets: {
    // `assetKitId` is the per-row discriminator (`null` = standalone
    // slice, non-null = kit-driven slice). Booking UI grouping reads
    // this instead of `asset.assetKits[0]?.kit` so a standalone scan
    // of a qty-tracked asset doesn't get rendered under a kit it
    // doesn't belong to in this booking. The id is the FK to
    // `AssetKit`; the corresponding kit's name/id are resolved via
    // the asset's `assetKits` array below (same source data).
    include: {
      asset: {
        select: {
          id: true,
          title: true,
          type: true,
          consumptionType: true,
          unitOfMeasure: true,
          availableToBook: true,
          status: true,
          valuation: true,
          // `Asset.quantity` is the workspace stock pool — surfaced for QT
          // availability/headroom math, NOT for booking-value totals.
          // The booking total uses `BookingAsset.quantity` (booked units)
          // — see `calculateTotalValueOfAssets`. Using `asset.quantity`
          // there would value a 5-of-100 booking at 100 units.
          quantity: true,
          // Asset-code resolution fields — see `app/modules/barcode/display.ts`
          // for the canonical select shape. Tight `take: 1` + narrow `select`
          // keeps query weight minimal even with hundreds of booking assets.
          sequentialId: true,
          preferredBarcodeId: true,
          qrCodes: { take: 1, select: { id: true } },
          barcodes: { select: { id: true, type: true, value: true } },
          // `mainImage`/`thumbnailImage` are consumed by the partial
          // check-in drawer's "expected assets" list (see the loader in
          // `bookings.$bookingId.overview.checkin-assets.tsx`) and by
          // the synthetic scanned-item payload produced by
          // `quickCheckinQtyAssetAtom`. Selecting them here keeps those
          // flows on the existing booking query rather than issuing a
          // second round-trip for images.
          mainImage: true,
          thumbnailImage: true,
          // Tag names — searchable in-memory by filterBookingAssets (assets only).
          tags: { select: { name: true } },
          category: {
            select: {
              id: true,
              name: true,
              color: true,
            },
          },
          // Asset's location lives on the `AssetLocation` pivot post-4b.
          // Each row carries a `quantity` so we can surface "X units at L"
          // for qty-tracked assets; for INDIVIDUAL there's exactly one
          // row. Consumers normalise to a singular `location` via the
          // primary-location helper at the loader boundary, feeding the
          // Location column / sort / search added in main's perf rewrite.
          assetLocations: {
            select: {
              id: true,
              quantity: true,
              location: {
                select: { id: true, name: true },
              },
            },
          },
          // `kit.id`/`kit.image` are needed by the partial check-in
          // drawer so we can render a kit summary row grouped from
          // `booking.bookingAssets`. `location` + `category` are needed
          // for kit-group location sorting and kit-level search added
          // by main's perf rewrite — surfaced here under the pivot so
          // the slice's kit identity stays correct for qty-tracked.
          assetKits: {
            select: {
              // `id` lets the booking grouping logic match
              // `BookingAsset.assetKitId` against the asset's set of
              // AssetKit memberships so we can resolve the specific
              // kit a row was booked under (qty-tracked assets can be
              // in multiple kits).
              id: true,
              kitId: true,
              kit: {
                select: {
                  id: true,
                  name: true,
                  image: true,
                  location: {
                    select: { id: true, name: true },
                  },
                  category: {
                    select: { name: true },
                  },
                },
              },
            },
          },
        },
      },
    },
    // Base fetch order. The rendered order is computed in-memory by the
    // consuming route (groupAndSortAssetsByKit); this DB order only acts as
    // the stable tiebreaker fed into that sort. Kept identical to the
    // historical default (CHECKED_OUT first, then creation order) so the
    // in-memory sort receives the exact same input as before.
    orderBy: [
      { asset: { status: "desc" } }, // CHECKED_OUT (desc) comes before AVAILABLE (asc)
      { asset: { createdAt: "asc" } }, // Then by creation order as fallback
    ],
  },
  // Surface any outstanding `BookingModelRequest` rows (Book-by-Model
  // intent rows) alongside concrete `bookingAssets` so every loader
  // reusing this include can render the "unassigned model reservations"
  // section and the checkout guard can enforce fulfilment. Intentionally
  // kept cheap — `assetModel` selects just enough for UI/error
  // messaging; no deep graph traversal required.
  modelRequests: {
    include: {
      assetModel: true,
    },
  },
} satisfies Prisma.BookingInclude;

/**
 * Type for a booking with bookingAssets included, inferred from BOOKING_WITH_ASSETS_INCLUDE
 */
type BookingWithAssets = Prisma.BookingGetPayload<{
  include: typeof BOOKING_WITH_ASSETS_INCLUDE;
}>;

/**
 * Type for a single BookingAsset pivot row as returned by BOOKING_WITH_ASSETS_INCLUDE.
 * Inferred from the Prisma include to ensure type safety.
 */
export type BookingAsset = BookingWithAssets["bookingAssets"][number];

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
  type: "Item type",
} as const;

export type BookingAssetSortingOption =
  keyof typeof BOOKING_ASSET_SORTING_OPTIONS;
