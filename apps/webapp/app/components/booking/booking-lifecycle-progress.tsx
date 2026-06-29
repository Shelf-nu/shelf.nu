/**
 * Booking Lifecycle Progress
 *
 * Segmented progress bar for a booking's checkout/check-in lifecycle. Renders
 * four proportional segments — Booked (gray) / Partial (amber) / Fully out
 * (purple) / Returned (green) — plus a legend with per-bucket counts. The
 * Partial bucket only arises from quantity-tracked rows where some, but not
 * all, units are out. The headline label + count switch by phase: while items
 * remain Booked it reads "Check-out progress" (count = partial + fully out +
 * returned); once nothing is Booked it reads "Check-in progress"
 * (count = returned). Backed by {@link calculateBookingLifecycleProgress}.
 *
 * @see {@link file://./../../modules/booking/utils.server.ts}
 */
import type { BookingLifecycleProgress as Progress } from "~/modules/booking/utils.server";
import { tw } from "~/utils/tw";
import { InfoTooltip } from "../shared/info-tooltip";

/** A single legend entry (colored dot + label + count). */
function LegendItem({
  colorClassName,
  label,
  count,
}: {
  colorClassName: string;
  label: string;
  count: number;
}) {
  return (
    <span className="flex items-center gap-1 whitespace-nowrap text-xs text-gray-500">
      <span
        aria-hidden
        className={tw("inline-block size-2 rounded-full", colorClassName)}
      />
      {label} {count}
    </span>
  );
}

/**
 * Renders the segmented lifecycle bar for a booking.
 *
 * @param progress - Result of `calculateBookingLifecycleProgress`.
 */
export function BookingLifecycleProgress({ progress }: { progress: Progress }) {
  const {
    totalUnits,
    bookedCount,
    partialCount,
    checkedOutCount,
    returnedCount,
    checkoutProgressCount,
    checkinProgressCount,
    countMode,
  } = progress;

  if (totalUnits === 0) return null;

  const isCheckoutPhase = bookedCount > 0;
  const headlineLabel = isCheckoutPhase
    ? "Check-out progress"
    : "Check-in progress";
  const headlineCount = isCheckoutPhase
    ? checkoutProgressCount
    : checkinProgressCount;

  const widthPct = (n: number) => (totalUnits > 0 ? (n / totalUnits) * 100 : 0);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 text-sm text-gray-500">
          {headlineLabel}
          <InfoTooltip
            iconClassName="size-4"
            content={
              <>
                {countMode === "units" ? (
                  <p>Kits count as one item.</p>
                ) : (
                  <p>All assets inside kits are counted individually.</p>
                )}
                <p>
                  Partial means a quantity-tracked asset has some, but not all,
                  units out.
                </p>
              </>
            }
          />
        </span>
        <span className="text-sm font-medium text-gray-900">
          {headlineCount} / {totalUnits}
        </span>
      </div>

      <div
        role="img"
        aria-label={`${bookedCount} booked, ${partialCount} partial, ${checkedOutCount} checked out, ${returnedCount} returned, out of ${totalUnits}`}
        className="flex h-2 w-full overflow-hidden rounded-full bg-gray-200"
      >
        <div
          aria-hidden
          className="h-full bg-gray-300"
          style={{ width: `${widthPct(bookedCount)}%` }}
        />
        <div
          aria-hidden
          className="h-full bg-amber-500"
          style={{ width: `${widthPct(partialCount)}%` }}
        />
        <div
          aria-hidden
          className="h-full bg-violet-600"
          style={{ width: `${widthPct(checkedOutCount)}%` }}
        />
        <div
          aria-hidden
          className="h-full bg-green-500"
          style={{ width: `${widthPct(returnedCount)}%` }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <LegendItem
          colorClassName="bg-gray-300"
          label="Booked"
          count={bookedCount}
        />
        <LegendItem
          colorClassName="bg-amber-500"
          label="Partial"
          count={partialCount}
        />
        <LegendItem
          colorClassName="bg-violet-600"
          label="Fully out"
          count={checkedOutCount}
        />
        <LegendItem
          colorClassName="bg-green-500"
          label="Returned"
          count={returnedCount}
        />
      </div>
    </div>
  );
}
