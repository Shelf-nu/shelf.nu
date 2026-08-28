import { BookingStatus, type Prisma } from "@prisma/client";
import { ASSET_MODEL_IMAGE_SELECT } from "../asset/image-select";
import { TAG_WITH_COLOR_SELECT } from "../tag/constants";
import { USER_NAME_SELECT } from "../user/fields";

/**
 * Booking statuses an asset or kit can still be added to.
 *
 * DRAFT/RESERVED are not yet started; ONGOING/OVERDUE are active — items added
 * to an active booking stay AVAILABLE until purposefully checked out
 * (progressive checkout).
 *
 * This single list has to drive all three layers of the "Add to existing
 * booking" dialogs, or they disagree and rows vanish:
 *   1. the loader that seeds the picker (`loadBookingsData`),
 *   2. the `/api/model-filters` search the picker fires once you type,
 *   3. the client-side `renderItem` guard in the dialog itself.
 */
export const ADDABLE_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.DRAFT,
  BookingStatus.RESERVED,
  BookingStatus.ONGOING,
  BookingStatus.OVERDUE,
];

/**
 * Statuses where a booking is still being planned and nothing has physically
 * left the warehouse.
 *
 * Drives kit-membership removal: a kit-driven `BookingAsset` slice on one of
 * these bookings is DELETED when the asset leaves the kit (the booking tracks
 * the kit's contents), whereas on any other status the row survives as a
 * snapshot of what actually went out. See `removeKitSlicesFromPlanningBookings`
 * in `~/modules/kit/service.server`.
 *
 * Deliberately NOT {@link ADDABLE_BOOKING_STATUSES}: that list also includes
 * ONGOING/OVERDUE, where the items ARE physically out and deleting a slice
 * would strand custody and checkout attribution.
 */
export const PLANNING_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.DRAFT,
  BookingStatus.RESERVED,
];

/**
 * Whether an asset or kit can still be added to this booking.
 *
 * Used by the "Add to existing booking" dialogs to decide whether to render a
 * row for a booking the picker handed them. Accepts a loose shape because the
 * pickers pass records from two sources (the route loader and
 * `/api/model-filters`), neither of which is narrowed to `Booking` client-side.
 *
 * @param booking - Candidate booking; anything without a `status` is rejected.
 * @returns `true` when the booking's status is in {@link ADDABLE_BOOKING_STATUSES}.
 */
export function isAddableBooking(
  booking: { status?: string | null } | null | undefined
): boolean {
  return (
    !!booking?.status &&
    ADDABLE_BOOKING_STATUSES.includes(booking.status as BookingStatus)
  );
}

/** Includes needed for booking to have all data required for emails */
export const BOOKING_INCLUDE_FOR_EMAIL = {
  custodianTeamMember: true,
  custodianUser: true,
  // Include creator details so the notification resolver can add the
  // booking creator as a recipient when the org setting is enabled.
  // The four format-preference columns are carried so the email fan-out can
  // resolve this recipient's date/time formatting from the loaded row
  // (see NotificationRecipient) without a per-recipient DB fetch.
  creator: {
    select: {
      id: true,
      email: true,
      ...USER_NAME_SELECT,
      dateFormat: true,
      timeFormat: true,
      weekStart: true,
      timeZone: true,
    },
  },
  // Include per-booking notification recipients (team members explicitly
  // added to this booking) for the recipient resolver's step 6. Format-pref
  // columns carried for recipient-specific email formatting (see `creator`).
  notificationRecipients: {
    select: {
      id: true,
      name: true,
      user: {
        select: {
          id: true,
          email: true,
          ...USER_NAME_SELECT,
          dateFormat: true,
          timeFormat: true,
          weekStart: true,
          timeZone: true,
        },
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

/**
 * Per-booking `bookingAssets` payload for the bookings LIST surfaces.
 *
 * Single source of truth for the row shape the bookings-list assets drawer
 * (`BookingAssetsSidebar`) renders, shared by:
 * - `getBookings` (service.server.ts) — attached when `includeAssets` is true,
 *   which today means the bookings CSV select-all export;
 * - the `/api/bookings/:bookingId/assets-sidebar` resource route — the five
 *   bookings-list loaders no longer ship assets (the drawer fetches this exact
 *   shape when a row is expanded).
 *
 * Keeping both callers on one constant is what guarantees the drawer renders
 * identically no matter which path supplied the data.
 */
export const BOOKINGS_LIST_ASSETS_INCLUDE = {
  bookingAssets: {
    // Explicit `select` (instead of `include`) so the inferred
    // type surfaces `assetKitId` on each row — the bookings list
    // sidebar (`BookingAssetsSidebar`) groups by it. Without an
    // explicit select, Prisma's type inference for
    // `include + nested include` doesn't expose the parent
    // scalars in a form the local component types accept.
    select: {
      id: true,
      quantity: true,
      assetKitId: true,
      asset: {
        select: {
          title: true,
          id: true,
          type: true,
          quantity: true,
          custody: true,
          availableToBook: true,
          status: true,
          mainImage: true,
          thumbnailImage: true,
          // Model cover image for assets with no image of their own
          ...ASSET_MODEL_IMAGE_SELECT,
          mainImageExpiration: true,
          // Asset-code resolution fields — see `app/modules/barcode/display.ts`.
          // Surfaced by the BookingAssetsSidebar so the chip matches the
          // simple-mode booking overview list and every other code-bearing
          // surface (see .claude/rules/code-bearing-entity-list-consistency.md).
          sequentialId: true,
          preferredBarcodeId: true,
          qrCodes: { take: 1, select: { id: true } },
          barcodes: { select: { id: true, type: true, value: true } },
          category: {
            select: {
              id: true,
              name: true,
              color: true,
            },
          },
          // NOTE: deliberately NO `bookingAssets` here. A previous
          // version selected each asset's entire lifetime
          // `bookingAssets: { bookingId }` pivot history, which grows
          // without bound and had zero consumers (every reader of
          // `asset.bookingAssets` needs `ba.booking.{id,status}` from
          // asset-centric queries, which this shape cannot provide).
          // If a surface ever needs conflict info here, scope it with
          // a `where` on active statuses + date overlap like
          // getBookingFlags does.
          assetKits: {
            select: {
              // See the comment in `bookings.$bookingId.overview.tsx`
              // for why both `id` (the AssetKit row id) and `kitId`
              // are needed for kit-source grouping.
              id: true,
              kitId: true,
              kit: {
                select: {
                  id: true,
                  name: true,
                  image: true,
                  imageExpiration: true,
                  category: {
                    select: {
                      id: true,
                      name: true,
                      color: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.BookingInclude;

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
          // Model cover image for assets with no image of their own
          ...ASSET_MODEL_IMAGE_SELECT,
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
                  // Kit-code resolution, mirroring the asset select above.
                  // Kits carry Qr and Barcode rows too, and the sidebar's kit
                  // group header is a kit-listing surface — without these it
                  // is the only row in that sidebar with no code chip.
                  // Kit has no sequentialId / preferredBarcodeId; the resolver
                  // tolerates their absence and falls back to QR.
                  qrCodes: { take: 1, select: { id: true } },
                  barcodes: { select: { id: true, type: true, value: true } },
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
  autoArchiveExpiredHandler = `booking-auto-archive-expired-handler`,
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
