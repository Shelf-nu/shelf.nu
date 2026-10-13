/**
 * "Fulfils <model>" badge for booking asset rows that answered a model
 * reservation.
 *
 * A `BookingModelRequest` promises N units of a model without naming them.
 * When a concrete unit lands on the booking it discharges one, and
 * `BookingAsset.bookingModelRequestId` records which promise it answered —
 * but nothing rendered that link, so the counter moved in the reservations
 * section with nothing on the row explaining why. That is hardest to read
 * when the unit arrives inside a kit: the operator adds a kit and a number
 * changes somewhere else on the page.
 *
 * The model name is resolved server-side (`fulfilsModelName` on the booking
 * overview loader's per-slice projection) because the stamp does not survive
 * the `clientLoader` re-shape, and the request row it points at is not
 * reachable from the cached row at all.
 *
 * @see {@link file://./list-asset-content.tsx} the row that mounts this
 * @see {@link file://./../../routes/_layout+/bookings.$bookingId.overview.tsx} where the name is resolved
 */

import { PackageCheckIcon } from "lucide-react";
import { BADGE_COLORS } from "~/utils/badge-colors";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../shared/tooltip";

/**
 * Blue (informational) treatment — this is provenance, not a warning, so it
 * reads differently from the amber advisory chips beside it. Hoisted to module
 * scope so the style object keeps a stable identity across renders instead of
 * being rebuilt per row.
 */
const BADGE_STYLE = {
  backgroundColor: BADGE_COLORS.blue.bg,
  color: BADGE_COLORS.blue.text,
} as const;

/**
 * Small blue chip naming the model reservation this row discharged.
 *
 * Accessibility: the trigger is a real `<button>` (Radix's default trigger
 * element), so the tooltip is reachable by keyboard and not hover-only. The
 * meaning is carried by the visible text, never by the blue tint or the icon
 * alone (which is `aria-hidden`), per WCAG 1.4.1.
 *
 * Renders unconditionally — callers gate on `item.fulfilsModelName`.
 *
 * @param props.modelName - The reserved model this row answered.
 */
export function FulfilsModelBadge({ modelName }: { modelName: string }) {
  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger
          type="button"
          style={BADGE_STYLE}
          className="inline-flex cursor-help items-center gap-1 rounded-2xl px-2 py-[2px] text-xs font-medium"
        >
          <PackageCheckIcon aria-hidden="true" className="size-3" />
          Fulfils {modelName}
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start">
          <div className="max-w-[260px] text-left sm:max-w-[320px]">
            <h6 className="mb-1 text-xs font-semibold text-gray-700">
              Answers a reserved unit
            </h6>
            <div className="whitespace-normal text-xs font-medium text-gray-500">
              This booking reserved units of <strong>{modelName}</strong>{" "}
              without naming them. This asset is one of the units that answered
              that reservation, so it counts toward it instead of adding to the
              booking on its own.
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
