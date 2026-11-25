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
 *   units over the booking window.
 *
 * The display parts come from `describeBookingSources` in
 * `@shelf/quantity-control`; this file only decides whether the cell applies
 * ({@link selectPoolSourceCell}) and renders it. Rows the selector rejects
 * keep the ordinary Location cell.
 *
 * @see {@link file://./list-asset-content.tsx} the row that mounts this
 * @see {@link file://./../../routes/_layout+/bookings.$bookingId.overview.tsx} the loader that builds the cells
 */

import {
  formatSourceSummary,
  type BookingSourcePart,
} from "@shelf/quantity-control";
import type { SourceAllocationMode } from "~/modules/booking/sources/types";
import { BADGE_COLORS } from "~/utils/badge-colors";
import { LocationBadge } from "../location/location-badge";
import { Tag } from "../shared/tag";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../shared/tooltip";

/** What the Location cell renders for one pool slice. */
export type PoolSourceCell = {
  /** Display parts, ordered by location name, then the non-location kinds. */
  parts: BookingSourcePart[];
};

/**
 * Whether a booking slice is a standalone pool slice: a quantity-tracked
 * asset with no live kit (`assetKitId` null). `sourceKitId` is provenance
 * only, so units left behind when an asset leaves a kit count as standalone.
 *
 * @param slice - The booking slice with its asset's type
 * @returns True when the slice's Location cell may show its sources
 */
export function isStandalonePoolSlice(slice: {
  asset: { type: string };
  assetKitId: string | null;
}): boolean {
  return slice.asset.type === "QUANTITY_TRACKED" && !slice.assetKitId;
}

/**
 * Decides whether a slice's Location cell shows its sources.
 *
 * Only standalone pool slices (quantity-tracked and not kit-driven, which
 * includes units left behind when an asset leaves a kit) allocated by source
 * (`AUTO` or `MANUAL`) with something to show qualify. A pool without manual placements keeps the
 * ordinary cell while all its units come from Unplaced: every unit of such a
 * pool is unplaced, so the sources would say nothing new. Individual assets,
 * kit rows and `LEGACY` slices never reach this cell.
 *
 * @param args.summary - The slice's source summary from the loader, if any
 * @param args.isStandalonePoolSlice - Output of {@link isStandalonePoolSlice}
 * @param args.hasManualPlacements - The pool has at least one non-kit placement
 * @returns The cell to render, or `null` to keep the ordinary Location cell
 */
export function selectPoolSourceCell(args: {
  summary:
    | { parts: BookingSourcePart[]; mode: SourceAllocationMode }
    | undefined;
  isStandalonePoolSlice: boolean;
  hasManualPlacements: boolean;
}): PoolSourceCell | null {
  const { summary, isStandalonePoolSlice, hasManualPlacements } = args;
  if (!summary || !isStandalonePoolSlice) return null;
  if (summary.mode !== "AUTO" && summary.mode !== "MANUAL") return null;
  if (summary.parts.length === 0) return null;
  if (
    !hasManualPlacements &&
    summary.parts.every((part) => part.kind === "UNPLACED")
  ) {
    return null;
  }
  return { parts: summary.parts };
}

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
 * @property cell - Output of {@link selectPoolSourceCell}
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
  // "Needs a location" already says what is wrong, so it gets no extra chip.
  const shortParts = parts.filter(
    (part) => part.short && part.kind !== "UNASSIGNED"
  );

  return (
    <div className="flex flex-col items-start gap-1">
      {parts.length === 1 ? (
        <SingleSource part={parts[0]} rowLocation={rowLocation} />
      ) : (
        <SplitSources parts={parts} />
      )}
      {shortParts.map((part) => (
        <span key={part.key} style={WARNING_STYLE} className={WARNING_CLASS}>
          Short at {part.label}
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
