/**
 * Booking page Location cell for a pool slice with recorded sources.
 *
 * A standalone slice of a quantity-tracked pool plans its units from one or
 * more sources (locations, Unplaced, Unknown, or "Needs a location" when no
 * source is chosen yet). The cell shows where the units come from:
 *
 * - one source: its `LocationBadge` (or a plain chip for a non-location source);
 * - several sources: one wrapping line such as "Demo Warehouse 8 · Unplaced 7",
 *   with a tooltip listing planned and out units per source;
 * - a "Short at {source}" chip for each source that cannot cover its pending
 *   units over the booking window (the warnings of `describeSourceLine`).
 *
 * The display parts come from `describeBookingSources` in
 * `@shelf/quantity-control`, and whether the cell applies comes from
 * `selectPoolSourceCell` in `~/modules/booking/sources/pool-source-cell`;
 * this file only renders it. Rows the selector rejects keep the ordinary
 * Location cell.
 *
 * @see {@link file://./list-asset-content.tsx} the row that mounts this
 * @see {@link file://./../../modules/booking/sources/pool-source-cell.ts} the selector
 * @see {@link file://./../../routes/_layout+/bookings.$bookingId.overview.tsx} the loader that builds the cells
 */

import {
  describeSourceLine,
  formatSourceSummary,
  type BookingSourcePart,
} from "@shelf/quantity-control";
import type { PoolSourceCell } from "~/modules/booking/sources/pool-source-cell";
import { BADGE_COLORS } from "~/utils/badge-colors";
import { LocationBadge } from "../location/location-badge";
import { Tag } from "../shared/tag";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../shared/tooltip";

/** Amber treatment for warnings; hoisted so the style keeps a stable identity. */
const WARNING_STYLE = {
  backgroundColor: BADGE_COLORS.amber.bg,
  color: BADGE_COLORS.amber.text,
} as const;

/** Classes shared by the amber warning chips. */
const WARNING_CLASS =
  "inline-flex items-center rounded-2xl px-2 py-0.5 text-[12px] font-medium";

/** The row's own location, used to keep the hierarchy popover on a match. */
type RowLocation = {
  id: string;
  name: string;
  parentId?: string | null;
  _count?: { children?: number } | null;
} | null;

/**
 * Props for {@link BookingSourceCell}.
 *
 * @property cell - Output of `selectPoolSourceCell`
 * @property rowLocation - The asset's primary location; when the single
 *   source is this location, the badge keeps its hierarchy popover
 */
type BookingSourceCellProps = {
  cell: PoolSourceCell;
  rowLocation?: RowLocation;
};

/**
 * Renders the Location cell for a pool slice with sources.
 *
 * Accessibility: the split summary is a real `<button>` tooltip trigger, so
 * the per-source breakdown is reachable by keyboard and linked through
 * `aria-describedby` while open. Shortness is carried by visible text, never
 * by the amber tint alone (WCAG 1.4.1).
 */
export function BookingSourceCell({
  cell,
  rowLocation,
}: BookingSourceCellProps) {
  const { parts } = cell;
  // The "Short at" notes come from the shared line the PDF and the companion
  // print, so all three name a short source the same way. Two locations with
  // the same name read the same note, so it is shown once.
  const warnings = [...new Set(describeSourceLine(parts)?.warnings ?? [])];

  return (
    <div className="flex flex-col items-start gap-1">
      {parts.length === 1 ? (
        <SingleSource part={parts[0]} rowLocation={rowLocation} />
      ) : (
        <SplitSources parts={parts} />
      )}
      {warnings.map((warning) => (
        <span key={warning} style={WARNING_STYLE} className={WARNING_CLASS}>
          {warning}
        </span>
      ))}
    </div>
  );
}

/** One source: its location badge, or a chip naming the non-location source. */
function SingleSource({
  part,
  rowLocation,
}: {
  part: BookingSourcePart;
  rowLocation?: RowLocation;
}) {
  if (part.kind === "LOCATION" && part.locationId) {
    const matchesRow = rowLocation?.id === part.locationId;
    return (
      <LocationBadge
        className="ml-0"
        location={{
          id: part.locationId,
          name: part.label,
          parentId: matchesRow ? rowLocation?.parentId ?? undefined : undefined,
          childCount: matchesRow ? rowLocation?._count?.children ?? 0 : 0,
        }}
      />
    );
  }
  if (part.kind === "UNASSIGNED") {
    return (
      <span style={WARNING_STYLE} className={WARNING_CLASS}>
        {part.label}
      </span>
    );
  }
  return <Tag>{part.label}</Tag>;
}

/** Several sources: one wrapping summary line with a per-source tooltip. */
function SplitSources({ parts }: { parts: BookingSourcePart[] }) {
  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger
          type="button"
          className="cursor-help whitespace-normal break-words text-left text-sm text-gray-700 underline decoration-dotted underline-offset-2"
        >
          {formatSourceSummary(parts)}
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start">
          <div className="max-w-[260px] text-left sm:max-w-[320px]">
            <h6 className="mb-1 text-xs font-semibold text-gray-700">
              Sources
            </h6>
            <ul className="space-y-0.5 whitespace-normal text-xs font-medium text-gray-500">
              {parts.map((part) => (
                <li key={part.key}>
                  <span className="text-gray-700">{part.label}</span>:{" "}
                  {part.planned} planned, {part.out} out
                </li>
              ))}
            </ul>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
