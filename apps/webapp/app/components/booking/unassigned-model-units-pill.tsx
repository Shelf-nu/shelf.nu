/**
 * Amber "N units unassigned" pill.
 *
 * Rendered wherever a booking is summarised, whenever it still holds
 * outstanding `BookingModelRequest` units. Model reservations are a commitment
 * to supply N of some model without yet naming which physical assets, so a
 * booking carrying them is **not ready to leave** — somebody still has to walk
 * to a shelf and scan those units in.
 *
 * Before this pill existed, the bookings index showed only the concrete asset
 * count, which made a half-assigned booking look identical to a finished one.
 * A customer read "7 assets" on a job that actually needed 7 assets *plus* 4
 * unassigned units and reported it as a counting bug — the count was correct,
 * the missing signal was the problem.
 *
 * Deliberately the same amber as the reservation rows inside the booking
 * (`booking-model-reservations-section.tsx`), so the summary and the detail
 * reconcile by recognition rather than by arithmetic. Sits alongside the
 * existing "Stock conflict" and "Includes unavailable assets" signals in the
 * same column, which are the same class of thing: something needs attention
 * before this booking goes out.
 *
 * Index-only. Inside a booking the reservations get a titled section that says
 * this better than a pill can, so the pill would be redundant there — a table
 * cell has no room for a section, which is why the two surfaces differ.
 *
 * Counts UNITS, not request rows — see
 * {@link file://./../../utils/booking-model-requests.ts}.
 *
 * @see {@link file://./list-bookings-content.tsx}
 * @see {@link file://./booking-model-reservations-section.tsx}
 */
import { BADGE_COLORS } from "~/utils/badge-colors";
import { Badge } from "../shared/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../shared/tooltip";

/** Props for {@link UnassignedModelUnitsPill}. */
type UnassignedModelUnitsPillProps = {
  /**
   * Outstanding units awaiting assignment, from `countUnassignedModelUnits`.
   * The component renders nothing at `0`, so callers don't need their own
   * guard.
   */
  count: number;
};

/**
 * Renders the outstanding-model-units signal, or `null` when there is no
 * outstanding work.
 *
 * @param props.count - Units still awaiting assignment.
 */
export function UnassignedModelUnitsPill({
  count,
}: UnassignedModelUnitsPillProps) {
  if (count <= 0) {
    return null;
  }

  const label = `${count} ${count === 1 ? "unit" : "units"} unassigned`;

  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* `role="img"` + `aria-label` so screen-reader users get the full
              explanation rather than the bare pill text (WCAG 2.1 AA). A
              non-interactive role — rather than `tabIndex`/`role="button"` —
              keeps this valid inside the clickable booking row and satisfies
              jsx-a11y/no-noninteractive-tabindex. Mirrors `StockConflictPill`
              in `list-bookings-content.tsx`. */}
          <span
            role="img"
            aria-label={`${label}. This booking reserves asset models that have not been matched to physical assets yet. Scan them in before check-out.`}
            className="cursor-help"
          >
            <Badge
              color={BADGE_COLORS.amber.bg}
              textColor={BADGE_COLORS.amber.text}
              withDot={false}
            >
              {label}
            </Badge>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" align="center" className="max-w-xs">
          Reserved models that have not been matched to physical assets yet.
          Scan them in before check-out.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
