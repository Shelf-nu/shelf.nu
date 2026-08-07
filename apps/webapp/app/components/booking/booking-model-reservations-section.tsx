/**
 * "Unassigned model reservations" section.
 *
 * A `BookingModelRequest` is a commitment to supply N units of an asset model
 * without yet naming which physical assets. Until somebody scans units in, a
 * booking carrying reservations is **not ready to leave**.
 *
 * This section is the single rendering of that state, shared by the booking
 * overview and the bookings-index assets drawer. It deliberately sits ABOVE
 * the Assets & Kits list rather than inside it, because reservations are not
 * assets:
 *
 *   - Every count then describes the rows directly beneath it. The Assets &
 *     Kits header counts asset/kit rows and there are exactly that many; this
 *     header counts reservations and there are exactly that many. Nothing to
 *     reconcile.
 *   - Both denominators are stated together ("4 units across 2 models"), so a
 *     reader never has to work out whether a number means rows or units.
 *   - Reservations are not selectable, so keeping them out of the bulk-actions
 *     table removes the mismatch rather than working around it.
 *
 * Previously the overview interleaved reservation rows into the assets table
 * and added their count into the list header, which made the header disagree
 * with both the visible rows and the bookings index. A customer reported that
 * as a counting bug. See {@link file://./../../utils/booking-model-requests.ts}
 * for the units-not-rows counting rule.
 *
 * @see {@link file://./booking-assets-column.tsx} — booking overview
 * @see {@link file://./booking-assets-sidebar.tsx} — index drawer
 * @see {@link file://./unassigned-model-units-pill.tsx} — index row signal
 */
import type { ReactNode } from "react";
import { Package as PackageIcon } from "lucide-react";
import { BADGE_COLORS } from "~/utils/badge-colors";
import {
  countReservedModelUnits,
  countUnassignedModelUnits,
  getOutstandingModelRequests,
} from "~/utils/booking-model-requests";
import { tw } from "~/utils/tw";

/**
 * Shape of a reservation this section renders. Declared structurally so both
 * call sites can pass their own loader-shaped rows without a widening cast.
 */
export type SectionModelRequest = {
  id: string;
  assetModelId: string;
  quantity: number;
  fulfilledQuantity: number;
  fulfilledAt: Date | string | null;
  assetModel: { id: string; name: string };
};

/** Props for {@link BookingModelReservationsSection}. */
type BookingModelReservationsSectionProps = {
  /**
   * The booking's model requests. Fulfilled rows are filtered out here, so
   * callers can pass the relation as-is. Tolerates `null`/`undefined`.
   */
  modelRequests: SectionModelRequest[] | null | undefined;
  /**
   * Trailing control for each row. The overview passes the full actions
   * dropdown (scan to assign / remove); the drawer passes a plain
   * "Scan to assign" link. Presentation stays identical either way — only the
   * affordance differs, matching what each surface can actually do.
   */
  renderAction?: (request: SectionModelRequest) => ReactNode;
  /**
   * Primary action for the section as a whole, rendered beside the heading.
   *
   * Without it the only way to act on outstanding work was a per-row kebab,
   * while the Assets & Kits list directly below carried two full-size buttons.
   * The section describing what the booking still OWES had the weakest
   * affordance on the page, so "what do I do about this" had no visible answer
   * short of starting a check-out.
   */
  headerAction?: ReactNode;
  /** Extra classes for the outer wrapper (surface-specific spacing). */
  className?: string;
};

/**
 * States a single reservation's outstanding work.
 *
 * ALWAYS `"X of Y units still to assign"`, never a bare count, even when
 * nothing has been assigned yet and X equals Y.
 *
 * An earlier version dropped the denominator on untouched rows, so a booking
 * showed "3 units to assign" next to "1 of 2 units still to assign". Two rows
 * of the same kind in two shapes, with the shape changing only once something
 * had been scanned in. A reader could not tell whether the bare 3 meant three
 * promised or three left, and checking the section total meant adding a bare
 * number to the numerator of a fraction.
 *
 * Keeping one shape makes the whole section self-checking: the X's sum to the
 * units still to assign, the Y's sum to the units reserved, and both totals
 * appear in the header in the same `"X of Y"` form.
 *
 * @param request - The reservation.
 * @returns e.g. `"3 of 3 units still to assign"`, `"1 of 2 units still to
 *   assign"`.
 */
function describeOutstanding(request: SectionModelRequest): string {
  const remaining = Math.max(0, request.quantity - request.fulfilledQuantity);

  // The noun agrees with the TOTAL, not the remainder, or it reads
  // "1 of 2 unit".
  return `${remaining} of ${request.quantity} ${
    request.quantity === 1 ? "unit" : "units"
  } still to assign`;
}

/**
 * Renders the outstanding reservations for a booking, or `null` when there is
 * no outstanding work (so callers need no guard of their own).
 */
export function BookingModelReservationsSection({
  modelRequests,
  renderAction,
  headerAction,
  className,
}: BookingModelReservationsSectionProps) {
  const outstanding = getOutstandingModelRequests(modelRequests);

  if (outstanding.length === 0) {
    return null;
  }

  const units = countUnassignedModelUnits(modelRequests);
  const reserved = countReservedModelUnits(modelRequests);

  return (
    <div className={tw("overflow-hidden rounded border bg-white", className)}>
      <div className="flex items-start justify-between gap-3 border-b border-gray-200 p-4 md:px-6">
        <div>
          <h5 className="text-left text-text-sm font-semibold text-gray-900">
            Unassigned model reservations
          </h5>
          {/* Same `"X of Y units"` shape the rows use, so the header is checkable
            against them by eye: the rows' first numbers sum to X and their
            second numbers sum to Y. Stating both stops a reader having to
            guess whether a lone number means promised or remaining. */}
          <p className="text-sm text-gray-600">
            {units} of {reserved} {reserved === 1 ? "unit" : "units"} still to
            assign, across {outstanding.length}{" "}
            {outstanding.length === 1 ? "model" : "models"}
          </p>
        </div>
        {headerAction ? <div className="shrink-0">{headerAction}</div> : null}
      </div>

      <table className="w-full border-collapse">
        <tbody>
          {outstanding.map((request) => (
            <tr
              key={`model-reservation-${request.id}`}
              className="border-b border-gray-200 last:border-b-0"
            >
              <td className="w-full whitespace-normal p-0 md:p-0">
                <div className="flex items-center gap-3 p-4 md:px-6">
                  {/* Neutral placeholder — models carry no image on this
                      surface, and fetching one would cost an extra query. */}
                  <div
                    aria-hidden
                    className="flex size-12 shrink-0 items-center justify-center rounded-[4px] border border-gray-200 bg-gray-50"
                  >
                    <PackageIcon className="size-5 text-gray-400" />
                  </div>
                  <div className="min-w-0">
                    <span className="block truncate font-medium text-gray-900">
                      {request.assetModel.name}
                    </span>
                    <span
                      className="mt-1 inline-flex items-center rounded-2xl px-2 py-[2px] text-xs font-medium"
                      style={{
                        backgroundColor: BADGE_COLORS.amber.bg,
                        color: BADGE_COLORS.amber.text,
                      }}
                    >
                      {describeOutstanding(request)}
                    </span>
                  </div>
                </div>
              </td>

              {renderAction ? (
                <td className="pr-4 text-right align-middle md:pr-6">
                  {renderAction(request)}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
