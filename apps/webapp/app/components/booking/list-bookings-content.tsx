/**
 * Row renderer for the shared bookings list (`<List ItemComponent={...}>`).
 *
 * Used by all FIVE bookings-list surfaces — the main index
 * (`bookings._index.tsx`) plus `me.bookings`, `assets.$assetId.bookings`,
 * `kits.$kitId.bookings` and `settings.team.users.$userId.bookings`, each of
 * which renders `<BookingsIndexPage />` and so reuses this same row. One
 * render change here covers all of them.
 *
 * Kept in its own file (rather than inline in the route module) so it can be
 * unit-tested without pulling in the route's `loader` (real `db`) and its
 * other heavy siblings (`CreateBookingDialog`, `BulkActionsDropdown`, …) —
 * see `list-bookings-content.test.tsx`.
 *
 * @see {@link file://../../routes/_layout+/bookings._index.tsx}
 */
import type { Prisma } from "@prisma/client";
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
      // Included via `extraInclude` in every bookings-list loader so the
      // assets-sidebar drawer can show outstanding model reservations, and so
      // the drawer trigger opens for a pure book-by-model booking.
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
     * Concrete `BookingAsset` rows on this booking. The rows themselves are
     * NOT shipped with the list — the drawer fetches them on open — so the
     * count is what the trigger renders.
     */
    _count: { bookingAssets: number };
    /**
     * Set by every bookings-list loader via `decorateBookingsForList` — true
     * when ≥1 of this booking's QUANTITY_TRACKED assets is over-committed in
     * its window. Optional because it is computed, not a real Prisma column.
     */
    hasStockConflict?: boolean;
    /**
     * Set by the same decorator — true when this booking holds an asset that
     * is not bookable, or an INDIVIDUAL asset someone has custody of. This
     * used to be derived in the browser from `bookingAssets`, which the list
     * no longer ships; the type-aware rule now lives in
     * `~/modules/booking/list-flags.server`.
     */
    hasUnavailableAssets?: boolean;
  };
};

/**
 * Renders one row of the shared bookings list.
 *
 * Every signal this row shows comes from the row itself. The two pills are
 * resolved server-side by `decorateBookingsForList` and the drawer fetches its
 * own payload, so there is nothing here to derive from an asset array — which
 * is also why the SHELF-WEBAPP-1NW normalisation this function used to open
 * with is gone: there is no `bookingAssets` left to be undefined.
 *
 * @param props.item - The booking row plus the two computed pill flags. See
 *   {@link ListBookingsContentProps}.
 */
export default function ListBookingsContent({
  item,
}: ListBookingsContentProps) {
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
        {item.hasUnavailableAssets ? (
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
          <BookingAssetsSidebar booking={item} />
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
            user: item?.custodianUser ?? null,
          }}
        />
      </Td>

      {/* Created by */}
      <Td>
        <UserBadge user={item?.creator} />
      </Td>
    </>
  );
}
