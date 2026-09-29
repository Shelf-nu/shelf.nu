/**
 * Quantity Breakdown Tooltip
 *
 * Renders the hover-card body for a quantity-tracked asset:
 * - "X of Y checked out" / "reserved" headlines
 * - Standalone vs via-kit slice breakdown (Polish-6 discriminator)
 * - Per-booking bullets with each booking name as a link
 * - Custody line + "N available" footer
 *
 * Lives next to {@link AssetStatusBadge} but separately so the badge
 * file stays focused on the wrapper / lazy-fetch orchestration.
 *
 * @see {@link file://./asset-status-badge.tsx}
 * @see {@link file://./quantity-data.ts}
 */

import { Link } from "react-router";
import { DateS } from "~/components/shared/date";
import { tw } from "~/utils/tw";
import type { BookingAssetRecord, QuantityBreakdown } from "./quantity-data";

/**
 * How many booking bullets one bucket may render before collapsing into a
 * "+N more" line.
 *
 * A quantity pool has no natural ceiling on future bookings: a rental house can
 * have a cable booked every week for a year, and this card had no `take` on the
 * query and no cap on the render, so it would emit one bullet per booking,
 * hundreds of rows in a hover card, taller than the viewport, over a row the
 * user was only passing across.
 *
 * Four is enough to show a pattern and short enough that the "N free right now"
 * footer stays on screen, which is the line people actually came for. Slices
 * arrive sorted soonest-first, so the ones that survive the cut are the
 * imminent ones.
 */
const MAX_SLICES_SHOWN = 4;

/** Longest booking name rendered before ellipsis. Names are free text and unbounded. */
const MAX_BOOKING_NAME_CHARS = 34;

/** Renders a booking name as an inline link with an optional "· via {kit}" suffix. */
function SliceBookingName({
  slice,
}: {
  slice: {
    bookingId?: string;
    bookingName: string;
    viaKitName?: string;
  };
}) {
  /**
   * Truncated in the middle of the layout rather than by CSS: this sits inside
   * a hover card that sizes to its content, so a 200-character booking name
   * would stretch the card across the viewport instead of wrapping politely.
   * The full name stays available through `title`.
   */
  const displayName =
    slice.bookingName.length > MAX_BOOKING_NAME_CHARS
      ? `${slice.bookingName.slice(0, MAX_BOOKING_NAME_CHARS - 1)}…`
      : slice.bookingName;

  return (
    <>
      {slice.bookingId ? (
        <Link
          to={`/bookings/${slice.bookingId}`}
          target="_blank"
          title={slice.bookingName}
          className="text-gray-700 underline decoration-gray-300 underline-offset-2 hover:text-gray-900 hover:decoration-gray-500"
        >
          {displayName}
        </Link>
      ) : (
        <span title={slice.bookingName}>{displayName}</span>
      )}
      {slice.viaKitName && (
        <span className="text-gray-500"> · via {slice.viaKitName}</span>
      )}
    </>
  );
}

/**
 * Renders the rich hover-card content for a quantity-tracked asset.
 * Shows per-booking breakdown when bookings are involved, plus
 * custody and availability lines.
 */
export function QuantityTooltipContent({ data }: { data: QuantityBreakdown }) {
  const {
    total,
    inCustody,
    reserved,
    checkedOut,
    bookingAssets,
    assetKits,
    nextReservedFrom,
    freeNow,
  } = data;

  /* Map `assetKitId` → kit name so kit-driven slices surface the kit they
   * belong to ("via Kit A — 50 units") instead of the generic "via kits". */
  const kitNameByAssetKitId = new Map<string, string>();
  for (const ak of assetKits) {
    if (ak.id) kitNameByAssetKitId.set(ak.id, ak.kit?.name ?? "kit");
  }

  type Slice = {
    bookingId?: string;
    bookingName: string;
    viaKitName?: string;
    quantity: number;
    /** Booking start, when the loader selected it. Absent on surfaces that don't. */
    from?: string | Date | null;
  };
  type Buckets = { standalone: Slice[]; kitDriven: Slice[] };

  function makeBuckets(): Buckets {
    return { standalone: [], kitDriven: [] };
  }

  function pushSlice(buckets: Buckets, ba: BookingAssetRecord) {
    const slice: Slice = {
      bookingId: ba.booking?.id,
      bookingName: ba.booking?.name ?? "Untitled booking",
      quantity: ba.quantity ?? 0,
      from: ba.booking?.from ?? null,
    };
    if (ba.assetKitId) {
      slice.viaKitName = kitNameByAssetKitId.get(ba.assetKitId) ?? "kit";
      buckets.kitDriven.push(slice);
    } else {
      buckets.standalone.push(slice);
    }
  }

  const ongoing: Buckets = makeBuckets();
  const reservedSlices: Buckets = makeBuckets();

  for (const ba of bookingAssets) {
    const bStatus = ba.booking?.status;
    if (bStatus === "ONGOING" || bStatus === "OVERDUE") pushSlice(ongoing, ba);
    else if (bStatus === "RESERVED") pushSlice(reservedSlices, ba);
  }

  const sum = (slices: Slice[]) =>
    slices.reduce((acc, s) => acc + s.quantity, 0);

  /** Distinct bookings across both sub-buckets, one booking can own several slices. */
  const countBookings = (buckets: Buckets) =>
    new Set(
      [...buckets.standalone, ...buckets.kitDriven].map(
        (s) => s.bookingId ?? s.bookingName
      )
    ).size;

  /**
   * Renders one bucket's slices, capped.
   *
   * The cap is display-only, every total above it is computed from the FULL
   * set, so truncating the list can never make a number wrong. Slices arrive
   * soonest-first, so the survivors are the imminent ones.
   */
  function renderSlices(slices: Slice[], keyPrefix: string) {
    const shown = slices.slice(0, MAX_SLICES_SHOWN);
    const hidden = slices.length - shown.length;
    return (
      <>
        {shown.map((b, i) => (
          <p
            key={`${keyPrefix}-${b.bookingId ?? b.bookingName}-${
              b.viaKitName ?? ""
            }-${i}`}
            className="pl-4 text-gray-600"
          >
            • <SliceBookingName slice={b} />: {b.quantity}{" "}
            {b.quantity === 1 ? "unit" : "units"}
            {b.from ? (
              <span className="text-gray-500">
                {" "}
                · from <DateS date={b.from} />
              </span>
            ) : null}
            {/* A single booking asking for more than the whole pool is a real
                over-commitment, unlike a large SUM across bookings that never
                overlap. Flag it here, on the booking responsible. */}
            {total > 0 && b.quantity > total ? (
              <span className="text-violet-700"> · more than you own</span>
            ) : null}
          </p>
        ))}
        {hidden > 0 ? (
          <p className="pl-4 text-gray-500">
            + {hidden} more {hidden === 1 ? "booking" : "bookings"}
          </p>
        ) : null}
      </>
    );
  }

  function renderBuckets({
    buckets,
    headlineCount,
    headlineLabel,
  }: {
    buckets: Buckets;
    headlineCount: number;
    headlineLabel: string;
  }) {
    const standaloneTotal = sum(buckets.standalone);
    const kitTotal = sum(buckets.kitDriven);
    const bookingCount = countBookings(buckets);

    /**
     * "X of Y" only reads correctly while X is bounded by Y, and this count is
     * a SUM ACROSS BOOKINGS while `total` is a stock level, so the comparison
     * is a category error the moment an asset is busy. A cable booked every
     * week for a year reads "500 reserved" against a pool of 10 and nothing is
     * wrong. The card used to render "500 of 10 reserved", then "10 available"
     * directly beneath it: two statements that cannot both be true in any plain
     * reading, and an alarm where there was no problem.
     *
     * Above the pool, state the aggregation instead of the false comparison.
     * Genuine over-commitment is a PER-BOOKING fact and is flagged on the
     * offending bullet, which is also what the `Short` verdict keys off.
     */
    const exceedsPool = headlineCount > total;
    /**
     * The assets index sends totals but no slices (see `StatusColumn`), so
     * `bookingCount` is 0 there. Saying "across 0 bookings" would be worse than
     * saying nothing, drop to the bare count and let the date line carry the
     * "these are in the future" signal.
     */
    const headline = !exceedsPool
      ? `${headlineCount} of ${total} ${headlineLabel}`
      : bookingCount > 0
      ? `${headlineCount} ${headlineLabel} across ${bookingCount} ${
          bookingCount === 1 ? "booking" : "bookings"
        }`
      : `${headlineCount} ${headlineLabel}`;
    return (
      <div>
        <p className="font-semibold text-gray-900">{headline}</p>
        {standaloneTotal > 0 && (
          <>
            <p className="pl-2 text-gray-700">
              <span className="font-medium">{standaloneTotal}</span> standalone
            </p>
            {renderSlices(buckets.standalone, "s")}
          </>
        )}
        {kitTotal > 0 && (
          <>
            <p className="pl-2 text-gray-700">
              <span className="font-medium">{kitTotal}</span> via kits
            </p>
            {renderSlices(buckets.kitDriven, "k")}
          </>
        )}
      </div>
    );
  }

  return (
    // HoverCard shell is `bg-white` — use readable grays in the 600-800
    // range and let the headline stay at default (near-black).
    <div className="space-y-1 text-xs text-gray-800">
      {/* Checked-out summary */}
      {checkedOut > 0 &&
        renderBuckets({
          buckets: ongoing,
          headlineCount: checkedOut,
          headlineLabel: "checked out",
        })}

      {/* Reserved summary */}
      {reserved > 0 && (
        <>
          {renderBuckets({
            buckets: reservedSlices,
            headlineCount: reserved,
            headlineLabel: "reserved",
          })}
          {/* Only when the surface shipped no slices, otherwise each bullet
              already carries its own date and this would just repeat the first
              one. This is the line that stops "12 reserved" and "10 free right
              now" reading as a contradiction: the units are still here, and
              this says when they leave. */}
          {countBookings(reservedSlices) === 0 && nextReservedFrom ? (
            <p className="pl-2 text-gray-600">
              soonest starts <DateS date={nextReservedFrom} />
            </p>
          ) : null}
        </>
      )}

      {/* Custody line (only when there's also booking data, otherwise
       * show a simpler format) */}
      {inCustody > 0 && (checkedOut > 0 || reserved > 0) && (
        <p className="text-gray-700">{inCustody} in custody</p>
      )}

      {/* Simple custody-only format (no bookings involved) */}
      {inCustody > 0 && checkedOut === 0 && reserved === 0 && (
        <p className="text-gray-700">
          {inCustody} of {total} in custody
        </p>
      )}

      {/* "Free right now", not "available", every other line in this card
          describes a booking window in the future, and this one describes the
          shelf today. Without the time word the card reads as arithmetic that
          does not close: "12 reserved" above "10 available". Matches the
          `Free now` column on the assets index.

          Emerald when non-zero so the "you can still book N" signal pops;
          muted gray when zero. */}
      <p
        className={tw(
          "font-medium",
          freeNow > 0 ? "text-emerald-700" : "text-gray-500"
        )}
      >
        {freeNow} free right now
      </p>
    </div>
  );
}
