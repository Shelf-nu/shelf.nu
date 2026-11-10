/**
 * More Locations Chip
 *
 * The "+N" chip shown beside an asset's primary location badge when its units
 * sit at more than one location (a quantity-tracked asset split across
 * placements). Hovering or focusing it lists every location, primary first.
 *
 * Shared by every asset list with a Location column so the count and the
 * tooltip read the same everywhere.
 *
 * @see {@link file://./../assets/assets-index/advanced-asset-columns.tsx} assets index
 * @see {@link file://./../../routes/_layout+/bookings.$bookingId.overview.manage-assets.tsx} booking picker
 */
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/shared/tooltip";

/** A location as the chip lists it. */
type ChipLocation = { id: string; name: string };

/**
 * Renders "+N" for the locations beyond the primary one, with a tooltip
 * listing all of them. Renders nothing when there are no other locations.
 *
 * Callers may pass one entry per placement: a quantity-tracked asset can hold
 * a manual placement and kit-driven ones at the same location. The chip
 * collapses them to distinct locations, so "+N" counts places, not rows.
 *
 * @param props.primary - The location already shown as the badge
 * @param props.others - Every further placement, in placement order
 */
export function MoreLocationsChip({
  primary,
  others,
}: {
  primary: ChipLocation;
  others: ChipLocation[];
}) {
  const distinctOthers = distinctLocations(primary, others);
  if (distinctOthers.length === 0) return null;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="shrink-0 cursor-help whitespace-nowrap rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 focus-visible:ring-offset-1"
            data-testid="location-more-chip"
            aria-label={`+${distinctOthers.length} more location${
              distinctOthers.length === 1 ? "" : "s"
            }`}
          >
            +{distinctOthers.length}
          </button>
        </TooltipTrigger>
        <TooltipContent
          className="max-w-xs"
          data-testid="location-more-tooltip"
        >
          <ul className="flex flex-col gap-1 text-sm">
            {[primary, ...distinctOthers].map((entry) => (
              <li key={entry.id}>{entry.name}</li>
            ))}
          </ul>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * The locations in `others` that are not the primary, each once, in their
 * first-seen order.
 */
function distinctLocations(primary: ChipLocation, others: ChipLocation[]) {
  const seen = new Set([primary.id]);
  const distinct: ChipLocation[] = [];
  for (const location of others) {
    if (seen.has(location.id)) continue;
    seen.add(location.id);
    distinct.push(location);
  }
  return distinct;
}
