/**
 * "Removed from kit" badge for booking asset rows that are detached kit
 * residue.
 *
 * `BookingAsset.assetKitId` is an FK to the `AssetKit` MEMBERSHIP row with
 * `ON DELETE SET NULL`, so taking an asset out of a kit nulls it on every
 * booking slice. Planning-status bookings (DRAFT / RESERVED) drop those slices
 * outright; every other status KEEPS them and re-groups them under the
 * original kit via the durable `BookingAsset.sourceKitId`. Without this badge
 * such a row is visually identical to a live kit member — and the kit header
 * counts it, so a booking can read "3 assets" while the kit itself now holds
 * two, with nothing on screen explaining the gap.
 *
 * The condition is resolved server-side (`isRemovedFromKit` on the booking
 * overview loader's per-slice projection) because the discriminating fields
 * don't survive the `clientLoader` re-shape.
 *
 * @see {@link file://./list-asset-content.tsx} the row that mounts this
 * @see {@link file://./../../routes/_layout+/bookings.$bookingId.overview.tsx} where the flag is derived
 */

import { TriangleAlertIcon } from "lucide-react";
import { BADGE_COLORS } from "~/utils/badge-colors";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../shared/tooltip";

/**
 * Amber (warning) treatment, matching the tone of the row's other advisory
 * badges. Hoisted to module scope so the style object keeps a stable identity
 * across renders instead of being rebuilt per row.
 */
const BADGE_STYLE = {
  backgroundColor: BADGE_COLORS.amber.bg,
  color: BADGE_COLORS.amber.text,
} as const;

/**
 * Small amber chip explaining that this booking row's asset is no longer a
 * member of the kit it renders under.
 *
 * Accessibility: the trigger is a real `<button>` (Radix's default trigger
 * element), so the tooltip is reachable by keyboard and not hover-only. The
 * meaning is carried by the visible text, never by the amber tint or the icon
 * alone (which is `aria-hidden`), per WCAG 1.4.1.
 *
 * Renders unconditionally — callers gate on `item.isRemovedFromKit`.
 */
export function RemovedFromKitBadge() {
  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger
          type="button"
          style={BADGE_STYLE}
          className="inline-flex cursor-help items-center gap-1 rounded-2xl px-2 py-[2px] text-xs font-medium"
        >
          <TriangleAlertIcon aria-hidden="true" className="size-3" />
          Removed from kit
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start">
          <div className="max-w-[260px] text-left sm:max-w-[320px]">
            <h6 className="mb-1 text-xs font-semibold text-gray-700">
              No longer part of this kit
            </h6>
            <div className="whitespace-normal text-xs font-medium text-gray-500">
              This asset was removed from the kit after this booking was made.
              It stays on the booking as a record of what was booked, so
              in-progress and past bookings aren&apos;t rewritten.
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
