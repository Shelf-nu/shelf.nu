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
import { tw } from "~/utils/tw";
import type { BookingAssetRecord, QuantityBreakdown } from "./quantity-data";

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
  return (
    <>
      {slice.bookingId ? (
        <Link
          to={`/bookings/${slice.bookingId}`}
          target="_blank"
          className="text-gray-700 underline decoration-gray-300 underline-offset-2 hover:text-gray-900 hover:decoration-gray-500"
        >
          {slice.bookingName}
        </Link>
      ) : (
        <span>{slice.bookingName}</span>
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
    available,
    bookingAssets,
    assetKits,
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
    return (
      <div>
        <p className="font-semibold text-gray-900">
          {headlineCount} of {total} {headlineLabel}
        </p>
        {standaloneTotal > 0 && (
          <>
            <p className="pl-2 text-gray-700">
              <span className="font-medium">{standaloneTotal}</span> standalone
            </p>
            {buckets.standalone.map((b) => (
              <p
                key={`s-${b.bookingId ?? b.bookingName}`}
                className="pl-4 text-gray-600"
              >
                • <SliceBookingName slice={b} /> — {b.quantity}{" "}
                {b.quantity === 1 ? "unit" : "units"}
              </p>
            ))}
          </>
        )}
        {kitTotal > 0 && (
          <>
            <p className="pl-2 text-gray-700">
              <span className="font-medium">{kitTotal}</span> via kits
            </p>
            {buckets.kitDriven.map((b) => (
              <p
                key={`k-${b.bookingId ?? b.bookingName}-${b.viaKitName ?? ""}`}
                className="pl-4 text-gray-600"
              >
                • <SliceBookingName slice={b} /> — {b.quantity}{" "}
                {b.quantity === 1 ? "unit" : "units"}
              </p>
            ))}
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
      {reserved > 0 &&
        renderBuckets({
          buckets: reservedSlices,
          headlineCount: reserved,
          headlineLabel: "reserved",
        })}

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

      {/* Available line — emerald when non-zero so the "you can still
          book N" signal pops; muted gray when zero. */}
      <p
        className={tw(
          "font-medium",
          available > 0 ? "text-emerald-700" : "text-gray-500"
        )}
      >
        {available} available
      </p>
    </div>
  );
}
