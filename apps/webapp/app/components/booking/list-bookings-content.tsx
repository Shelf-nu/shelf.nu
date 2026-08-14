/**
 * Row renderer for the shared bookings list (`<List ItemComponent={...}>`).
 *
 * Used by BOTH the main bookings index (`bookings._index.tsx`) and the
 * asset's Bookings tab (`assets.$assetId.bookings.tsx`, which renders
 * `<BookingsIndexPage />` and therefore reuses this same row component) —
 * one render change here covers both surfaces.
 *
 * Kept in its own file (rather than inline in the route module) so it can be
 * unit-tested without pulling in the route's `loader` (real `db`) and its
 * other heavy siblings (`CreateBookingDialog`, `BulkActionsDropdown`, …) —
 * see `list-bookings-content.test.tsx`.
 *
 * @see {@link file://../../routes/_layout+/bookings._index.tsx}
 */
import type { Prisma } from "@prisma/client";
import { useLoaderData } from "react-router";
import { isQuantityTracked } from "~/modules/asset/utils";
import { hasCustody } from "~/modules/custody/utils";
import type { BookingsIndexLoaderData } from "~/routes/_layout+/bookings._index";
import { BADGE_COLORS } from "~/utils/badge-colors";
import {
  canAssignModelUnits,
  countUnassignedModelUnits,
} from "~/utils/booking-model-requests";
import { resolveUserDisplayName } from "~/utils/user";
import { AvailabilityBadge } from "./availability-label";
import { BookingAssetsSidebar } from "./booking-assets-sidebar";
import { BookingStatusBadge } from "./booking-status-badge";
import { UnassignedModelUnitsPill } from "./unassigned-model-units-pill";
import LineBreakText from "../layout/line-break-text";
import ItemsWithViewMore from "../list/items-with-view-more";
import { Badge } from "../shared/badge";
import { Button } from "../shared/button";
import { DateS } from "../shared/date";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../shared/tooltip";
import { UserBadge } from "../shared/user-badge";
import { Td } from "../table";
import { TeamMemberBadge } from "../user/team-member-badge";

/**
 * Amber "Stock conflict" pill rendered next to the Assets-column link when
 * `item.hasStockConflict` is true (≥1 of this booking's QUANTITY_TRACKED
 * assets is over-committed for its window — see
 * `~/modules/booking/stock-conflicts.server`).
 *
 * Deliberately a plain boolean-driven pill with no per-conflict detail
 * (which other booking(s) it collides with, by how many units): that
 * information could leak another booking's existence/dates to a viewer who
 * shouldn't see it, so it's safe to render for every role. The tooltip
 * points the user at the booking itself to investigate further.
 *
 * Hoisted to module scope (not defined inside `ListBookingsContent`) per
 * `.claude/rules/react-render-stability.md` — stable component identity
 * across row re-renders.
 */
function StockConflictPill() {
  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* `role="img"` + `aria-label` so screen-reader users get the full
              explanation, not just the bare "Stock conflict" text (WCAG 2.1
              AA). A non-interactive role (rather than `tabIndex`/`role=button`)
              keeps this valid inside the clickable booking row and satisfies
              jsx-a11y/no-noninteractive-tabindex. */}
          <span
            role="img"
            aria-label="Stock conflict: one or more quantity-tracked assets are over-reserved for these dates. Open the booking to resolve."
            className="cursor-help"
          >
            <Badge
              color={BADGE_COLORS.amber.bg}
              textColor={BADGE_COLORS.amber.text}
              withDot={false}
            >
              Stock conflict
            </Badge>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" align="center" className="max-w-xs">
          One or more quantity-tracked assets are over-reserved for these dates.
          Open the booking to resolve.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Props for {@link ListBookingsContent}. */
type ListBookingsContentProps = {
  item: Prisma.BookingGetPayload<{
    include: {
      bookingAssets: {
        select: {
          id: true;
          quantity: true;
          // Surfaces the kit-source discriminator the sidebar groups
          // by. Without this field on the index loader's type, the
          // sidebar's `BookingWithAssets` type check rejects the data.
          assetKitId: true;
          asset: {
            select: {
              id: true;
              title: true;
              type: true;
              consumptionType: true;
              availableToBook: true;
              custody: true;
              status: true;
              // Drives the calm "Archived" signal in the assets sidebar
              // (issue #382) — the sidebar's BookingWithAssets type requires it.
              archivedAt: true;
              mainImage: true;
              thumbnailImage: true;
              mainImageExpiration: true;
              // Model cover image for assets with no image of their own. Type
              // literal, so it mirrors ASSET_MODEL_IMAGE_SELECT by hand.
              assetModel: { select: { image: true; thumbnailImage: true } };
              // Code-resolution fields - mirror of getBookings' assets select
              sequentialId: true;
              preferredBarcodeId: true;
              qrCodes: { take: 1; select: { id: true } };
              barcodes: { select: { id: true; type: true; value: true } };
              category: {
                select: {
                  id: true;
                  name: true;
                  color: true;
                };
              };
              assetKits: {
                select: {
                  id: true;
                  kitId: true;
                  kit: {
                    select: {
                      id: true;
                      name: true;
                      image: true;
                      imageExpiration: true;
                      category: {
                        select: {
                          id: true;
                          name: true;
                          color: true;
                        };
                      };
                    };
                  };
                };
              };
            };
          };
        };
      };
      creator: {
        select: {
          id: true;
          firstName: true;
          lastName: true;
          displayName: true;
          profilePicture: true;
        };
      };
      custodianUser: true;
      custodianTeamMember: true;
      tags: { select: { id: true; name: true; color: true } };
      // Included via `extraInclude` in the bookings-index loader so the
      // assets-sidebar drawer can show outstanding model reservations.
      modelRequests: {
        include: {
          assetModel: {
            select: { id: true; name: true };
          };
        };
      };
    };
  }> & {
    /**
     * Set by both bookings-list loaders (`bookings._index.tsx` and
     * `assets.$assetId.bookings.tsx`, which share this component) via
     * `getStockConflictedBookingIds` — true when ≥1 of this booking's
     * QUANTITY_TRACKED assets is over-committed in its window. Optional
     * because it's computed, not a real Prisma column.
     */
    hasStockConflict?: boolean;
  };
};

/**
 * Renders one row of the shared bookings list.
 *
 * @param props.item - The booking row, plus the computed `hasStockConflict`
 *   flag. See {@link ListBookingsContentProps}.
 */
export default function ListBookingsContent({
  item: rawItem,
}: ListBookingsContentProps) {
  // Defensive normalisation against a Sentry-observed crash
  // (SHELF-WEBAPP-1NW): a single client-side render hit
  // `item.bookingAssets` as undefined and tripped `.some(...)`, breaking
  // the row through the error boundary. The component's prop type
  // declares `bookingAssets` as required and the loader always selects
  // it, so the undefined was either a stale-bundle / hydration mismatch
  // in the deploy window or an as-yet unidentified loader edge case.
  //
  // Normalise once at the top so EVERY downstream reader gets a safe
  // array — the badge calc below, `<BookingAssetsSidebar />` (which
  // calls `groupAssets(booking.bookingAssets)` + reads
  // `booking.bookingAssets.length` in multiple places), and any future
  // additions. A scoped `?? []` on each reader would be brittle.
  const item = {
    ...rawItem,
    bookingAssets: rawItem.bookingAssets ?? [],
  };

  /**
   * `hasCustody` is a bare "does this asset have ANY custody row" test, which
   * is the right question for an INDIVIDUAL asset (one custodian holds the
   * one physical thing, so the booking really is compromised) and the WRONG
   * one for `QUANTITY_TRACKED`. A QT asset is a pool: handing 20 of 29 units
   * to a custodian leaves 9 bookable, and a booking drawing on those free
   * units is perfectly valid. Flagging it "Includes unavailable assets"
   * scared a customer off a booking that had already checked out cleanly.
   *
   * Every other surface already makes this distinction — `getBookingFlags`
   * (`hasAssetsInCustody`), the per-asset booking row, and the three
   * server-side checkout guards all exempt QT from custody blocking. This
   * row was the last one keying off raw custody presence.
   *
   * The genuine QT signal is stock, not custody, and it has its own pill:
   * `item.hasStockConflict` → `<StockConflictPill />` further down this row
   * fires when booked quantity exceeds available quantity. `availableToBook`
   * still applies to both types — that flag means "never bookable", which is
   * true regardless of how the asset counts its units.
   */
  const hasUnavaiableAssets =
    item.bookingAssets.some(
      (ba) =>
        !ba.asset.availableToBook ||
        (!isQuantityTracked(ba.asset) && hasCustody(ba.asset.custody))
    ) && !["COMPLETE", "CANCELLED", "ARCHIVED"].includes(item.status);

  /**
   * Pull this booking's slice of the page-wide dispositioned-quantity
   * map so the sidebar can render qty progress + partial-checkin badge.
   * Reading from loader data here (instead of threading a prop through
   * `<List ItemComponent=…>`) keeps the list plumbing unchanged.
   */
  const loaderData = useLoaderData<BookingsIndexLoaderData>();
  const dispositionedByAsset =
    loaderData?.dispositionedByBooking?.[item.id] ?? undefined;
  const dispositionBreakdownByAsset =
    loaderData?.dispositionBreakdownByBooking?.[item.id] ?? undefined;
  /**
   * Per-asset progressive-checkout totals for this booking. Drives the
   * sidebar's new amber "partially checked out, no returns yet" badge
   * + the `{checkedOut}/{booked}` qty display.
   */
  const checkedOutByAsset =
    loaderData?.checkedOutByBooking?.[item.id] ?? undefined;

  return (
    <>
      {/* Item */}
      <Td className="w-full min-w-52 whitespace-normal p-0 md:p-0">
        <div className="flex justify-between gap-3 p-4  md:justify-normal md:px-6">
          <div className="flex items-center gap-3">
            <div className="min-w-[130px]">
              <span className="word-break mb-1 block font-medium">
                <Button
                  to={`/bookings/${item.id}`}
                  variant="link"
                  className="text-left font-medium text-gray-900 hover:text-gray-700"
                >
                  {item.name}
                </Button>
              </span>
              <div className="">
                <BookingStatusBadge
                  status={item.status}
                  custodianUserId={item.custodianUserId || undefined}
                />
              </div>
            </div>
          </div>
        </div>
      </Td>

      {/**
       * Optional label when the booking includes assets that are either:
       * 1. Marked as not available for boooking
       * 2. Have custody
       * 3. Have other bookings with the same period - this I am not sure how to handle yet
       * */}
      <Td>
        {hasUnavaiableAssets ? (
          <AvailabilityBadge
            badgeText={"Includes unavailable assets"}
            tooltipTitle={"Booking includes unavailable assets"}
            tooltipContent={
              "There are some assets within this booking that are unavailable for reservation because they are checked-out, have custody assigned or are marked as not allowed to book"
            }
          />
        ) : null}
      </Td>

      {/* Assets count */}
      <Td>
        <div className="flex items-center gap-2">
          <BookingAssetsSidebar
            booking={item}
            dispositionedByAsset={dispositionedByAsset}
            dispositionBreakdownByAsset={dispositionBreakdownByAsset}
            checkedOutByAsset={checkedOutByAsset}
          />
          {/* The asset count above is concrete assets only. A booking can also
              hold model-level reservations with no physical asset behind them
              yet, which the count cannot express — so they get their own
              signal rather than being folded into the number. */}
          <UnassignedModelUnitsPill
            count={countUnassignedModelUnits(item.modelRequests)}
            canAssign={canAssignModelUnits(item.status)}
          />
          {item.hasStockConflict ? <StockConflictPill /> : null}
        </div>
      </Td>

      <Td className="max-w-62">
        {item.description ? <LineBreakText text={item.description} /> : null}
      </Td>

      {/* From */}
      <Td>
        {item.from ? (
          <div className="min-w-[130px]">
            <span className="word-break mb-1 block font-medium">
              <DateS date={item.from} />
            </span>
            <span className="block text-gray-600">
              <DateS date={item.from} onlyTime />
            </span>
          </div>
        ) : null}
      </Td>

      {/* To */}
      <Td>
        {item.to ? (
          <div className="min-w-[130px]">
            <span className="word-break mb-1 block font-medium">
              <DateS date={item.to} />
            </span>
            <span className="block text-gray-600">
              <DateS date={item.to} onlyTime />
            </span>
          </div>
        ) : null}
      </Td>

      <Td className="max-w-[auto]">
        <ItemsWithViewMore
          items={item.tags}
          idKey="id"
          labelKey="name"
          emptyMessage={<div className="text-sm text-gray-500">No tags</div>}
        />
      </Td>

      {/* Custodian */}

      <Td>
        <TeamMemberBadge
          teamMember={{
            name: item.custodianTeamMember
              ? item.custodianTeamMember.name
              : resolveUserDisplayName(item.custodianUser),
            user: item?.custodianUser
              ? {
                  id: item?.custodianUser?.id,
                  firstName: item?.custodianUser?.firstName,
                  lastName: item?.custodianUser?.lastName,
                  email: item?.custodianUser?.email,
                  profilePicture: item?.custodianUser?.profilePicture,
                }
              : null,
          }}
        />
      </Td>

      {/* Created by */}
      <Td>
        <UserBadge
          img={
            item?.creator?.profilePicture || "/static/images/default_pfp.jpg"
          }
          name={resolveUserDisplayName(item?.creator)}
        />
      </Td>
    </>
  );
}
