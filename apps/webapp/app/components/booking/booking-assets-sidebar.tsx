/**
 * Booking Assets Sidebar
 *
 * Right-side sheet that lists the concrete `BookingAsset` rows for a
 * booking (kits + individual assets) along with qty-progress indicators
 * for partial check-ins.
 *
 * Renders an "Unassigned model reservations" section (Book-by-Model)
 * above the asset list whenever the booking has outstanding
 * `BookingModelRequest` rows (quantity > 0). The `booking.modelRequests`
 * prop is optional so existing callers using the narrower inline
 * Prisma shape (see `_layout+/bookings._index.tsx`) keep working — the
 * section just renders nothing when the field is absent.
 *
 * @see {@link file://./../../modules/booking/constants.ts} BOOKING_WITH_ASSETS_INCLUDE
 * @see {@link file://./../../modules/booking-model-request/service.server.ts}
 */
import React, { useState } from "react";
import type { ReactNode } from "react";
import type { BookingStatus, Prisma } from "@prisma/client";
import { ChevronDownIcon, PackageIcon } from "lucide-react";
import { Link } from "react-router";
import { Button } from "~/components/shared/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "~/components/shared/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/shared/tooltip";
import { useCurrentOrganization } from "~/hooks/use-current-organization";
import { isQuantityTracked } from "~/modules/asset/utils";
import { resolveDisplayCode } from "~/modules/barcode/display";
import { BADGE_COLORS } from "~/utils/badge-colors";
import { tw } from "~/utils/tw";
import { InsufficientStockBadge } from "./availability-label";
import { AssetCodeBadge } from "../assets/asset-code-badge";
import { AssetImage } from "../assets/asset-image";
import { AssetStatusBadge } from "../assets/asset-status-badge";
import { CategoryBadge } from "../assets/category-badge";
import { ConsumptionTypeBadge } from "../assets/consumption-type-badge";
import KitImage from "../kits/kit-image";

type BookingWithAssets = Prisma.BookingGetPayload<{
  include: {
    bookingAssets: {
      select: {
        id: true;
        quantity: true;
        // Per-row kit-source discriminator so the sidebar can group
        // rows accurately rather than using `asset.assetKits[0]` as
        // a fallback.
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
            mainImage: true;
            thumbnailImage: true;
            mainImageExpiration: true;
            // Code-resolution fields — mirror of getBookings' assets select.
            // Enables the asset-code chip on every row, matching the booking
            // overview list and other code-bearing surfaces.
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
                // `id` lets the sidebar match BookingAsset's
                // `assetKitId` against the asset's set of memberships
                // so multi-kit qty-tracked assets surface under the
                // right kit (or stay standalone when assetKitId IS NULL).
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
  };
}>;

/**
 * Shape of a single `BookingModelRequest` row as consumed by this
 * sidebar. Matches the `BOOKING_WITH_ASSETS_INCLUDE` model-requests
 * selector but is declared structurally so callers that load bookings
 * with a narrower inline include (without `modelRequests`) can still
 * pass their object through without widening the prop type.
 */
export type SidebarModelRequest = {
  id: string;
  assetModelId: string;
  /** Total reserved units (original intent). Does not decrease on scan. */
  quantity: number;
  /** Units already materialised into `BookingAsset` rows via scan. */
  fulfilledQuantity: number;
  /** Set when `fulfilledQuantity === quantity`. `null` means outstanding. */
  fulfilledAt: Date | string | null;
  assetModel: { id: string; name: string };
};

/**
 * Per-asset disposition split used by the qty progress tooltip. Each
 * field is a cumulative total of ConsumptionLog rows for the
 * corresponding category for this booking+asset.
 */
export type DispositionBreakdown = {
  returned: number;
  consumed: number;
  lost: number;
  damaged: number;
};

interface BookingAssetsSidebarProps {
  /**
   * Booking object to render. Typed as `BookingWithAssets` plus an
   * optional `modelRequests` array so callers using the narrower inline
   * include (`bookings._index.tsx`) can pass their object without a
   * widening cast. When `modelRequests` is missing or empty, the
   * "Unassigned model reservations" section is not rendered.
   */
  booking: BookingWithAssets & {
    modelRequests?: SidebarModelRequest[] | null;
  };
  trigger?: ReactNode;
  /**
   * Optional map of `assetId → dispositionedQuantity` for this booking,
   * i.e. sum of RETURN + CONSUME + LOSS + DAMAGE ConsumptionLog rows.
   * When provided, the sidebar renders the qty column as `N / M`
   * progress with an explanatory tooltip and swaps the status badge
   * to "Partially checked in" for qty-tracked assets that have some
   * units dispositioned but a non-zero remaining. When undefined, the
   * sidebar falls back to the plain `× N` booked-quantity display —
   * which keeps older call sites working without changes.
   */
  dispositionedByAsset?: Record<string, number>;
  /**
   * Optional map of `assetId → per-category split`. Lets the tooltip
   * show Returned / Consumed / Lost / Damaged separately instead of
   * conflating them into a single "Checked in" total — lost and
   * damaged units shouldn't read the same as units back in the pool.
   * When undefined, the tooltip falls back to the single-total layout.
   */
  dispositionBreakdownByAsset?: Record<string, DispositionBreakdown>;
  /**
   * Optional map of `assetId → checkedOutQuantity` for this booking
   * (sum of progressive PartialBookingCheckout slices across every row
   * of that asset). Drives the new
   * `PARTIALLY_CHECKED_OUT_QTY_PENDING_RETURN` (amber, "partially
   * checked out, no returns yet") badge: an asset with
   * `checkedOutQuantity > 0 && dispositionedQuantity === 0` on an active
   * booking gets the amber badge, mirroring the per-row treatment on
   * the booking overview. Aggregated at the asset level (not per-row)
   * because the sidebar renders one row per asset.
   *
   * Multi-slice tie-break: if a multi-slice asset has one slice partly
   * IN (any disposition) and another slice still fully OUT, the
   * check-IN signal wins at this aggregate level — consistent with the
   * existing `PARTIALLY_CHECKED_OUT_QTY` precedence in this component.
   */
  checkedOutByAsset?: Record<string, number>;
  /**
   * Optional map of `assetId → units available across the workspace pool`
   * (after subtracting operator custody + other-booking reservations +
   * active checkouts elsewhere). Drives the `InsufficientStockBadge`
   * rendered alongside the status badge on QT rows whose `bookedQuantity`
   * exceeds the per-asset workspace headroom.
   *
   * Optional so callers that don't ship the map (e.g. the bookings index
   * sidebar trigger) keep working — the badge condition short-circuits
   * when the lookup is `undefined`. INDIVIDUAL assets are never surfaced
   * regardless (gated on `isQuantityTracked` at the render site).
   */
  availableUnitsByAsset?: Record<string, number>;
}

/**
 * Asset enriched with the booked quantity from the BookingAsset pivot,
 * plus a synthesised singular `kit` / `kitId` derived from the
 * AssetKit pivot. An asset has at most one kit (enforced by
 * `@@unique([assetId])` on AssetKit), so `kit`/`kitId` are scalars.
 */
type SidebarAssetBase = BookingWithAssets["bookingAssets"][number]["asset"];
type SidebarAsset = SidebarAssetBase & {
  bookedQuantity: number;
  kit: NonNullable<SidebarAssetBase["assetKits"][number]["kit"]> | null;
  kitId: string | null;
};

/**
 * Groups assets by kits and individual assets, similar to the original
 * pagination structure. Preserves booked quantity from the pivot row.
 */
function groupAssets(bookingAssets: BookingWithAssets["bookingAssets"]) {
  const itemsMap = new Map<
    string,
    {
      id: string;
      type: "kit" | "asset";
      assets: SidebarAsset[];
      kit?: SidebarAsset["kit"];
    }
  >();
  const individualAssets: SidebarAsset[] = [];

  bookingAssets.forEach((ba) => {
    // Pick the kit by matching `BookingAsset.assetKitId` against the
    // asset's `assetKits` set (mirror of the same logic in the booking
    // detail loader). Standalone slices have `ba.assetKitId == null`
    // and render in the individual bucket regardless of whether the
    // asset happens to be in any kit.
    const sourceKit = ba.assetKitId
      ? ba.asset.assetKits.find((ak) => ak.id === ba.assetKitId)?.kit ?? null
      : null;
    const asset: SidebarAsset = {
      ...ba.asset,
      bookedQuantity: ba.quantity,
      kit: sourceKit,
      kitId: sourceKit?.id ?? null,
    };
    if (asset.kitId && asset.kit) {
      const kitId = asset.kitId;
      const existing = itemsMap.get(kitId);
      if (existing && existing.type === "kit") {
        existing.assets.push(asset);
      } else {
        itemsMap.set(kitId, {
          id: kitId,
          type: "kit",
          assets: [asset],
          kit: asset.kit,
        });
      }
    } else {
      individualAssets.push(asset);
    }
  });

  individualAssets.forEach((asset) => {
    itemsMap.set(`asset-${asset.id}`, {
      id: `asset-${asset.id}`,
      type: "asset",
      assets: [asset],
    });
  });

  return Array.from(itemsMap.values());
}

/**
 * Render the asset title + status stack used by both the standalone
 * asset rows and the kit-expanded asset rows. Extracted because both
 * paths share the exact same treatment and we want the qty-progress
 * tooltip + partial-checkin badge in both places without duplication.
 */
function AssetTitleAndStatus({
  asset,
  bookingStatus,
  dispositionedByAsset,
  dispositionBreakdownByAsset,
  checkedOutByAsset,
  availableUnitsByAsset,
}: {
  asset: SidebarAsset;
  bookingStatus: BookingStatus;
  dispositionedByAsset?: Record<string, number>;
  dispositionBreakdownByAsset?: Record<string, DispositionBreakdown>;
  checkedOutByAsset?: Record<string, number>;
  /**
   * Per-asset workspace-availability lookup. Drives the
   * `InsufficientStockBadge` rendered alongside the status badge for QT
   * rows whose `bookedQuantity` exceeds the per-asset workspace headroom.
   * Optional — missing map short-circuits the badge condition.
   */
  availableUnitsByAsset?: Record<string, number>;
}) {
  // Workspace pref + addon entitlement — resolveDisplayCode short-circuits to
  // QR when the org has lost the barcode add-on, so this read is always safe.
  const currentOrganization = useCurrentOrganization();
  const displayCode = currentOrganization
    ? resolveDisplayCode({ entity: asset, organization: currentOrganization })
    : null;
  const qtyBooked = asset.bookedQuantity ?? 0;
  const qtyDispositioned = dispositionedByAsset?.[asset.id] ?? 0;
  // Total units progressively checked OUT across every slice of this asset
  // in this booking. Aggregated at the asset level because the sidebar
  // collapses multi-slice assets into one row.
  const qtyCheckedOut = checkedOutByAsset?.[asset.id] ?? 0;
  const qtyRemaining = Math.max(0, qtyBooked - qtyDispositioned);
  const qtyBreakdown: DispositionBreakdown | undefined =
    dispositionBreakdownByAsset?.[asset.id];

  const isActiveBooking =
    bookingStatus === "ONGOING" || bookingStatus === "OVERDUE";
  const isQtyFullyCheckedIn =
    isQuantityTracked(asset) &&
    qtyBooked > 0 &&
    qtyDispositioned >= qtyBooked &&
    isActiveBooking;
  const isQtyPartial =
    isQuantityTracked(asset) &&
    qtyBooked > 0 &&
    qtyDispositioned > 0 &&
    qtyRemaining > 0 &&
    isActiveBooking;
  /**
   * Pending-return signal: units are progressively checked out but
   * no disposition has been recorded yet. Mirrors the per-row branch
   * in `list-asset-content.tsx` (`isQtyPartiallyCheckedOut`) but
   * resolved at the asset level here because the sidebar aggregates
   * slices. Suppressed once any disposition exists — at that point
   * `PARTIALLY_CHECKED_OUT_QTY` (violet, "returns underway") wins.
   */
  const isQtyPartiallyCheckedOut =
    isQuantityTracked(asset) &&
    qtyBooked > 0 &&
    qtyCheckedOut > 0 &&
    // Upper guard: ONLY when SOME but not all booked units are out — the
    // service flips `asset.status = CHECKED_OUT` when all are out, so the
    // row falls through to the base status (violet "Checked out") instead
    // of being shadowed by the amber pending-return badge.
    qtyCheckedOut < qtyBooked &&
    qtyDispositioned === 0 &&
    isActiveBooking;

  /**
   * Sidebar mirrors the booking-row badge precedence:
   *  1. Fully reconciled → `PARTIALLY_CHECKED_IN` ("Already checked in",
   *     blue).
   *  2. Partly reconciled (some disposition, more outstanding) →
   *     `PARTIALLY_CHECKED_OUT_QTY` (violet, "returns underway").
   *  3. Progressively checked out, NO returns yet →
   *     `PARTIALLY_CHECKED_OUT_QTY_PENDING_RETURN` (amber, "action
   *     required") — new branch for the sidebar.
   *  4. Otherwise the asset's raw status.
   *
   * Order matters: the check-IN branches must win at the aggregate
   * level so a multi-slice asset with mixed in/out slices reads
   * "checked in" rather than "still out" (matches the existing
   * behavior before this change).
   */
  const effectiveStatus = isQtyFullyCheckedIn
    ? "PARTIALLY_CHECKED_IN"
    : isQtyPartial
    ? "PARTIALLY_CHECKED_OUT_QTY"
    : isQtyPartiallyCheckedOut
    ? "PARTIALLY_CHECKED_OUT_QTY_PENDING_RETURN"
    : asset.status;

  /**
   * Workspace-availability lookup for this row's asset (sidebar version).
   * Mirrors the per-row computation in `list-asset-content.tsx` — fires
   * the `InsufficientStockBadge` when the booked qty exceeds the global
   * pool's headroom on this asset, INDIVIDUAL assets excluded.
   *
   * Suppressed for COMPLETE / ARCHIVED bookings — the stock signal is
   * historical at that point and shouldn't surface as an actionable
   * warning.
   */
  const availableUnits = availableUnitsByAsset?.[asset.id];
  const hasInsufficientStock =
    isQuantityTracked(asset) &&
    availableUnits != null &&
    qtyBooked > availableUnits &&
    bookingStatus !== "COMPLETE" &&
    bookingStatus !== "ARCHIVED";

  return (
    <div className="min-w-[180px]">
      <span className="word-break mb-1 block">
        <Button
          to={`/assets/${asset.id}`}
          variant="link"
          className="text-left font-medium text-gray-900 hover:text-gray-700"
          target="_blank"
          onlyNewTabIconOnHover={true}
        >
          {asset.title}
        </Button>
        {/* Quantity for qty-tracked assets:
            - `N / M` (disposition over booked) with tooltip when there's
              been check-in activity (`qtyDispositioned > 0`).
            - `N / M` (checkedOut over booked) when units are progressively
              checked out but nothing returned yet — surfaces the
              "partially out, no returns yet" progress without inventing
              a third visual.
            - plain `× N` otherwise (DRAFT/RESERVED rows, fully out + no
              activity, etc.). */}
        {isQuantityTracked(asset) && qtyBooked > 0 ? (
          qtyDispositioned > 0 ? (
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className={tw(
                      "ml-1.5 inline-flex cursor-help items-center gap-1 text-xs tabular-nums",
                      qtyRemaining === 0 ? "text-emerald-700" : "text-gray-700"
                    )}
                  >
                    <span className="font-medium">{qtyDispositioned}</span>
                    <span className="text-gray-400">/ {qtyBooked}</span>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" align="center" className="max-w-xs">
                  <div className="flex flex-col gap-1 text-xs">
                    <div className="font-semibold text-gray-900">
                      {qtyRemaining === 0
                        ? "All units checked in"
                        : "Partially checked in"}
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-gray-600">Booked</span>
                      <span className="tabular-nums text-gray-900">
                        {qtyBooked}
                      </span>
                    </div>
                    {/* Per-category split when the loader ships it.
                        Rows are conditional so ONE_WAY assets don't
                        show "Returned: 0" and vice versa. */}
                    {qtyBreakdown ? (
                      <>
                        {qtyBreakdown.returned > 0 ? (
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-gray-600">Returned</span>
                            <span className="tabular-nums text-emerald-700">
                              {qtyBreakdown.returned}
                            </span>
                          </div>
                        ) : null}
                        {qtyBreakdown.consumed > 0 ? (
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-gray-600">Consumed</span>
                            <span className="tabular-nums text-gray-900">
                              {qtyBreakdown.consumed}
                            </span>
                          </div>
                        ) : null}
                        {qtyBreakdown.lost > 0 ? (
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-gray-600">Lost</span>
                            <span className="tabular-nums text-rose-700">
                              {qtyBreakdown.lost}
                            </span>
                          </div>
                        ) : null}
                        {qtyBreakdown.damaged > 0 ? (
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-gray-600">Damaged</span>
                            <span className="tabular-nums text-amber-700">
                              {qtyBreakdown.damaged}
                            </span>
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-gray-600">Checked in</span>
                        <span className="tabular-nums text-gray-900">
                          {qtyDispositioned}
                        </span>
                      </div>
                    )}
                    <div className="mt-1 flex items-center justify-between gap-3 border-t border-gray-100 pt-1">
                      <span className="text-gray-600">Remaining</span>
                      <span
                        className={tw(
                          "tabular-nums",
                          qtyRemaining === 0
                            ? "text-gray-400"
                            : "font-medium text-amber-700"
                        )}
                      >
                        {qtyRemaining}
                      </span>
                    </div>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : qtyCheckedOut > 0 && qtyCheckedOut < qtyBooked ? (
            // Progressive checkout in flight, no returns yet — show the
            // out-side progress (`checkedOut / booked`) so the user can
            // see how far along the row is. Distinct from the
            // `qtyDispositioned > 0` branch above, which counts what's
            // already back in.
            <span className="ml-1.5 inline-flex items-center gap-1 text-xs tabular-nums text-gray-700">
              <span className="font-medium">{qtyCheckedOut}</span>
              <span className="text-gray-400">/ {qtyBooked}</span>
            </span>
          ) : (
            <span className="ml-1.5 text-xs font-medium text-gray-500">
              &times; {qtyBooked}
            </span>
          )
        ) : null}
      </span>
      <div className="flex flex-wrap items-center gap-1">
        <AssetStatusBadge
          id={asset.id}
          status={effectiveStatus}
          availableToBook={asset.availableToBook}
          asset={asset}
        />
        {hasInsufficientStock ? (
          <InsufficientStockBadge
            bookedQuantity={qtyBooked}
            availableUnits={availableUnits ?? 0}
          />
        ) : null}
        {displayCode ? <AssetCodeBadge {...displayCode} /> : null}
        <ConsumptionTypeBadge consumptionType={asset.consumptionType ?? null} />
      </div>
    </div>
  );
}

/**
 * Render the "Unassigned model reservations" section shown above the
 * asset list when a booking has outstanding `BookingModelRequest` rows.
 *
 * Rows with `fulfilledAt !== null` (fully fulfilled) are filtered out
 * so the section disappears once every unit has been materialised.
 * The "Scan to assign" CTA routes to the generic scan-assets drawer —
 * scans materialise the matching request via the shared code path.
 * The *checkout* flow (with fulfil-enforcement + early-date alert)
 * lives separately on the main booking URL's Check Out button, which
 * routes to `/fulfil-and-checkout`.
 */
function UnassignedModelRequestsSection({
  bookingId,
  bookingStatus,
  modelRequests,
}: {
  bookingId: string;
  bookingStatus: BookingStatus;
  modelRequests: SidebarModelRequest[];
}) {
  const outstanding = modelRequests.filter((req) => req.fulfilledAt === null);
  if (outstanding.length === 0) {
    return null;
  }

  const totalRemaining = outstanding.reduce(
    (sum, req) => sum + (req.quantity - req.fulfilledQuantity),
    0
  );

  // Scan-to-assign is available whenever the booking is in a
  // manage-assets-eligible state. Keeps DRAFT/RESERVED unblocked — the
  // checkout guard requires all requests to be drained before ONGOING.
  const canScanToAssign =
    bookingStatus === "DRAFT" ||
    bookingStatus === "RESERVED" ||
    bookingStatus === "ONGOING" ||
    bookingStatus === "OVERDUE";

  return (
    <>
      <div className="border border-b-0 bg-white px-4 pb-3 pt-4 text-left font-normal text-gray-600 md:mx-0 md:px-6">
        <h5 className="text-left capitalize">
          Unassigned model reservations ({totalRemaining})
        </h5>
        <p>
          <span>
            {outstanding.length} {outstanding.length === 1 ? "model" : "models"}
          </span>
        </p>
      </div>
      <div className="border border-b-0 border-gray-200 bg-white md:mx-0">
        <table className="w-full border-collapse">
          <tbody>
            {outstanding.map((req) => (
              <tr
                key={req.id}
                className="border-b border-gray-200 last:border-b-0"
              >
                <td className="w-full whitespace-normal p-0 md:p-0">
                  <div className="flex items-center gap-3 px-6 py-4 md:pr-6">
                    {/* Model placeholder — we intentionally don't fetch
                        a per-model image for the sidebar (extra query
                        cost) so a neutral packaging glyph stands in. */}
                    <div
                      aria-hidden
                      className="flex size-12 shrink-0 items-center justify-center rounded-[4px] border border-gray-200 bg-gray-50"
                    >
                      <PackageIcon className="size-5 text-gray-400" />
                    </div>
                    <div className="min-w-[180px]">
                      <span className="word-break mb-1 block font-medium text-gray-700">
                        {req.assetModel.name}
                      </span>
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className="inline-flex items-center rounded-2xl px-2 py-[2px] text-[12px] font-medium"
                          style={{
                            backgroundColor: BADGE_COLORS.amber.bg,
                            color: BADGE_COLORS.amber.text,
                          }}
                        >
                          {req.quantity - req.fulfilledQuantity} remaining
                        </span>
                        {canScanToAssign ? (
                          <Link
                            to={`/bookings/${bookingId}/overview/scan-assets`}
                            className="text-[12px] font-medium text-primary-700 hover:text-primary-800 hover:underline"
                          >
                            Scan to assign
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function BookingAssetsSidebar({
  booking,
  trigger,
  dispositionedByAsset,
  dispositionBreakdownByAsset,
  checkedOutByAsset,
  availableUnitsByAsset,
}: BookingAssetsSidebarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [expandedKits, setExpandedKits] = useState<Record<string, boolean>>({});

  const paginatedItems = groupAssets(booking.bookingAssets);

  const toggleKitExpansion = (kitId: string) => {
    setExpandedKits((prev) => ({
      ...prev,
      [kitId]: !prev[kitId],
    }));
  };

  // The drawer is worth opening whenever the booking contains anything
  // worth showing — concrete assets OR outstanding model-level
  // reservations. Pure book-by-model bookings legitimately have
  // `bookingAssets.length === 0` but still carry content.
  const outstandingModelRequestCount = (booking.modelRequests ?? []).filter(
    (req) => req.fulfilledAt === null
  ).length;
  const hasItems =
    booking.bookingAssets.length > 0 || outstandingModelRequestCount > 0;
  const defaultTrigger = (
    <Button
      type="button"
      variant="link-gray"
      onClick={hasItems ? () => setIsOpen(true) : undefined}
      className={!hasItems ? "hover:text-gray cursor-default no-underline" : ""}
    >
      {booking.bookingAssets.length} assets
    </Button>
  );

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      {trigger || defaultTrigger}

      <SheetContent className="w-full border-l-0 bg-white p-0 md:w-[85vw] md:max-w-[85vw]">
        <div className="flex h-dvh w-full flex-col">
          <SheetHeader className="border-color-200 border-b px-6 py-3">
            <SheetTitle className="text-left">
              Assets in "{booking.name}"
            </SheetTitle>
            <SheetDescription className="text-left">
              {booking.bookingAssets.length}{" "}
              {booking.bookingAssets.length === 1 ? "asset" : "assets"} in this
              booking
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-1 flex-col overflow-hidden">
            {booking.modelRequests && booking.modelRequests.length > 0 ? (
              <UnassignedModelRequestsSection
                bookingId={booking.id}
                bookingStatus={booking.status}
                modelRequests={booking.modelRequests}
              />
            ) : null}
            <div className="border border-b-0 bg-white px-4 pb-3 pt-4 text-left font-normal text-gray-600 md:mx-0 md:px-6">
              <h5 className="text-left capitalize">Assets & kits</h5>
              <p>
                <span>{paginatedItems.length} items</span>
              </p>
            </div>

            <div className="flex-1 overflow-auto border border-b-0 border-gray-200 bg-white md:mx-0">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-gray-200 text-left ">
                    <th className="px-6 py-3 font-normal text-gray-600">
                      Name
                    </th>
                    <th className="px-6 py-3"> </th>
                    <th className="px-6 py-3 font-normal text-gray-600">
                      Category
                    </th>
                    <th className="px-6 py-3"> </th>
                  </tr>
                </thead>
                <tbody className="">
                  {paginatedItems.map((item) => {
                    if (item.type === "kit") {
                      const kit = item.kit;
                      const isExpanded = expandedKits[item.id] ?? false;

                      if (!kit) {
                        return null;
                      }

                      return (
                        <React.Fragment key={`kit-${item.id}`}>
                          {/* Kit Row */}
                          <tr className="relative border-b border-gray-200 bg-gray-50">
                            <td className="w-full whitespace-normal p-0 md:p-0">
                              <div className="flex items-center gap-3 px-6 py-4 md:justify-normal md:pr-6">
                                <KitImage
                                  kit={{
                                    image: kit.image,
                                    imageExpiration: kit.imageExpiration,
                                    alt: kit.name,
                                    kitId: kit.id,
                                  }}
                                  className="size-12 rounded-[4px] border object-cover"
                                />
                                <div>
                                  <Button
                                    to={`/kits/${kit.id}`}
                                    variant="link"
                                    className="text-gray-900 hover:text-gray-700"
                                    target="_blank"
                                    onlyNewTabIconOnHover={true}
                                    aria-label="Go to kit"
                                  >
                                    <div className="max-w-[200px] truncate sm:max-w-[250px] md:max-w-[350px] lg:max-w-[450px]">
                                      {kit.name}
                                    </div>
                                  </Button>
                                  <p className="text-sm text-gray-600">
                                    {item.assets.length} assets
                                  </p>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4"> </td>
                            <td className="px-6 py-4">
                              <CategoryBadge
                                category={kit.category}
                                className="whitespace-nowrap"
                              />
                            </td>
                            <td className="px-6 py-4 pr-4 text-right align-middle">
                              <div className="flex items-center justify-end gap-5">
                                <Button
                                  type="button"
                                  onClick={() => toggleKitExpansion(kit.id)}
                                  variant="link"
                                  className="text-center font-bold text-gray-600 hover:text-gray-900"
                                  aria-label="Toggle kit expand"
                                >
                                  <ChevronDownIcon
                                    className={tw(
                                      `size-6 ${
                                        !isExpanded ? "rotate-180" : ""
                                      }`
                                    )}
                                  />
                                </Button>
                              </div>
                            </td>
                          </tr>

                          {/* Kit Assets (when expanded) */}
                          {isExpanded &&
                            item.assets.map((asset) => (
                              <tr
                                key={`kit-asset-${asset.id}`}
                                className="relative border-b border-gray-200"
                              >
                                <td className="w-full whitespace-normal p-0 md:p-0">
                                  <div className="absolute inset-y-0 left-0 h-full w-2 bg-gray-100" />
                                  <div className="flex justify-between gap-3 bg-gray-50/50 px-6 py-4 md:justify-normal md:pr-6">
                                    <div className="flex items-center gap-3">
                                      <div className="relative flex size-12 shrink-0 items-center justify-center">
                                        <AssetImage
                                          asset={{
                                            id: asset.id,
                                            mainImage: asset.mainImage,
                                            thumbnailImage:
                                              asset.thumbnailImage,
                                            mainImageExpiration:
                                              asset.mainImageExpiration,
                                          }}
                                          alt={`Image of ${asset.title}`}
                                          className="size-full rounded-[4px] border border-gray-300 object-cover"
                                          withPreview
                                        />
                                      </div>
                                      <AssetTitleAndStatus
                                        asset={asset}
                                        bookingStatus={booking.status}
                                        dispositionedByAsset={
                                          dispositionedByAsset
                                        }
                                        dispositionBreakdownByAsset={
                                          dispositionBreakdownByAsset
                                        }
                                        checkedOutByAsset={checkedOutByAsset}
                                        availableUnitsByAsset={
                                          availableUnitsByAsset
                                        }
                                      />
                                    </div>
                                  </div>
                                </td>
                                <td className="bg-gray-50/50 px-6 py-4"> </td>
                                <td className="bg-gray-50/50 px-6 py-4">
                                  <CategoryBadge
                                    category={asset.category}
                                    className="whitespace-nowrap"
                                  />
                                </td>
                                <td className="bg-gray-50/50 px-6 py-4 pr-4 text-right">
                                  {" "}
                                </td>
                              </tr>
                            ))}

                          <tr className="kit-separator h-1 bg-gray-100">
                            <td colSpan={4} className="h-1 p-0"></td>
                          </tr>
                        </React.Fragment>
                      );
                    }

                    // Individual asset
                    const asset = item.assets[0];
                    return (
                      <tr
                        key={`asset-${asset.id}`}
                        className="border-b border-gray-200"
                      >
                        <td className="w-full whitespace-normal p-0 md:p-0">
                          <div className="flex justify-between gap-3 px-6 py-4 md:justify-normal md:pr-6">
                            <div className="flex items-center gap-3">
                              <div className="relative flex size-12 shrink-0 items-center justify-center">
                                <AssetImage
                                  asset={{
                                    id: asset.id,
                                    mainImage: asset.mainImage,
                                    thumbnailImage: asset.thumbnailImage,
                                    mainImageExpiration:
                                      asset.mainImageExpiration,
                                  }}
                                  alt={`Image of ${asset.title}`}
                                  className="size-full rounded-[4px] border object-cover"
                                  withPreview
                                />
                              </div>
                              <AssetTitleAndStatus
                                asset={asset}
                                bookingStatus={booking.status}
                                dispositionedByAsset={dispositionedByAsset}
                                dispositionBreakdownByAsset={
                                  dispositionBreakdownByAsset
                                }
                                checkedOutByAsset={checkedOutByAsset}
                                availableUnitsByAsset={availableUnitsByAsset}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4"> </td>
                        <td className="px-6 py-4">
                          <CategoryBadge
                            category={asset.category}
                            className="whitespace-nowrap"
                          />
                        </td>
                        <td className="px-6 py-4 pr-4 text-right"> </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
