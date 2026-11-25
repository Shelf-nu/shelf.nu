/**
 * Booking source display: turns a slice's (or a booking line's) source rows
 * into labelled parts and a one-line summary such as
 * "Demo Warehouse 8 · Unplaced 7".
 *
 * KIT rows never appear (kit units keep their own display). Rows with nothing
 * planned and nothing out are hidden, so a history-only UNKNOWN carrier shows
 * nothing. Rows of the same source are summed.
 *
 * Also holds the row line the PDF and the companion print
 * ({@link describeSourceLine}) and the check-out question's "As planned"
 * choice ({@link AS_PLANNED_SOURCE}), so both apps use the same words.
 *
 * @see {@link file://./booking-sources.ts} for the row model and source keys.
 */

import {
  compareCodeUnits,
  sourceKey,
  type SourceRowState,
} from "./booking-sources";

/** One displayed source of a booking line. */
export type BookingSourcePart = {
  key: string;
  kind: "LOCATION" | "UNPLACED" | "UNKNOWN" | "UNASSIGNED";
  locationId: string | null;
  label: string;
  /** Units planned from this source (`quantity - released`). */
  planned: number;
  /** Units from this source out right now. */
  out: number;
  /** True when the source cannot cover its pending units. */
  short: boolean;
};

/** Display order of the non-location kinds, after all locations. */
const KIND_ORDER: Record<BookingSourcePart["kind"], number> = {
  LOCATION: 0,
  UNPLACED: 1,
  UNKNOWN: 2,
  UNASSIGNED: 3,
};

/** User-facing label for a row; locations come from `locationNames`. */
function labelFor(
  kind: BookingSourcePart["kind"],
  locationId: string | null,
  locationNames: Map<string, string>
): string {
  switch (kind) {
    case "LOCATION":
      return (
        (locationId && locationNames.get(locationId)) || "Unknown location"
      );
    case "UNPLACED":
      return "Unplaced";
    case "UNKNOWN":
      return "Unknown";
    case "UNASSIGNED":
      return "Needs a location";
  }
}

/**
 * Builds the display parts for a set of source rows.
 *
 * @param args.rows - Source rows (any slices of one line)
 * @param args.locationNames - Location id to display name
 * @param args.shortSourceKeys - Source keys flagged short by the sweep
 * @returns Parts ordered by location name (case-insensitive, then by key for
 *   two locations of the same name), then Unplaced, Unknown, Needs a location
 */
export function describeBookingSources(args: {
  rows: Array<
    Pick<
      SourceRowState,
      "kind" | "locationId" | "quantity" | "outQuantity" | "releasedQuantity"
    >
  >;
  locationNames: Map<string, string>;
  shortSourceKeys: Set<string>;
}): BookingSourcePart[] {
  const merged = new Map<
    string,
    {
      kind: BookingSourcePart["kind"];
      locationId: string | null;
      planned: number;
      out: number;
      pending: number;
    }
  >();
  for (const row of args.rows) {
    if (row.kind === "KIT") continue;
    const key = sourceKey(row);
    const entry = merged.get(key) ?? {
      kind: row.kind,
      locationId: row.locationId,
      planned: 0,
      out: 0,
      pending: 0,
    };
    entry.planned += row.quantity - row.releasedQuantity;
    entry.out += row.outQuantity;
    entry.pending += row.quantity - row.releasedQuantity - row.outQuantity;
    merged.set(key, entry);
  }

  const parts: BookingSourcePart[] = [];
  for (const [key, e] of merged) {
    if (e.planned <= 0 && e.out <= 0) continue;
    parts.push({
      key,
      kind: e.kind,
      locationId: e.locationId,
      label: labelFor(e.kind, e.locationId, args.locationNames),
      planned: e.planned,
      out: e.out,
      short:
        args.shortSourceKeys.has(key) ||
        (e.kind === "UNASSIGNED" && e.pending > 0),
    });
  }
  return parts.sort(
    (a, b) =>
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      compareCodeUnits(a.label.toLowerCase(), b.label.toLowerCase()) ||
      compareCodeUnits(a.label, b.label) ||
      compareCodeUnits(a.key, b.key)
  );
}

/**
 * One-line summary of the parts, e.g. "Demo Warehouse 8 · Unplaced 7".
 *
 * @param parts - Output of {@link describeBookingSources}
 * @returns Parts as "label planned" joined by " · "; empty for no parts
 */
export function formatSourceSummary(parts: BookingSourcePart[]): string {
  return parts.map((p) => `${p.label} ${p.planned}`).join(" · ");
}

/** A slice's sources as one printed or spoken line. */
export type BookingSourceLine = {
  /**
   * The sources: the label alone for one source ("Demo Warehouse"), the
   * summary for several ("Demo Warehouse 8 · Unplaced 7").
   */
  text: string;
  /**
   * One "Short at {source}" per source that cannot cover its pending units.
   * "Needs a location" gets none: its label already says what is wrong.
   */
  warnings: string[];
};

/**
 * The line a booking row shows for a slice's sources, in the words the web
 * booking page uses: one source by name, several as the summary, and a
 * "Short at" note per short source. Shared by the PDF and the companion.
 *
 * @param parts - Output of {@link describeBookingSources}
 * @returns The line, or `null` when there are no parts
 */
export function describeSourceLine(
  parts: BookingSourcePart[]
): BookingSourceLine | null {
  if (parts.length === 0) return null;
  return {
    text: parts.length === 1 ? parts[0].label : formatSourceSummary(parts),
    warnings: parts
      .filter((p) => p.short && p.kind !== "UNASSIGNED")
      .map((p) => `Short at ${p.label}`),
  };
}

/**
 * Picker value of the check-out source question's "As planned" choice: the
 * slice's units leave by its planned sources, exactly as when nothing is
 * picked. The server sets it as the question's default for a slice whose
 * sources are planned, and drops it when it comes back, so sending it equals
 * not answering. Location ids are cuids, so the value cannot collide.
 */
export const AS_PLANNED_SOURCE = "__allocation__";

/**
 * The words of the "As planned" choice: the plan itself when it is known
 * ("As planned: Demo Warehouse 8 · Unplaced 7"), else just "As planned".
 *
 * @param plannedSummary - The question's planned sources as one line
 * @returns The choice label
 */
export function asPlannedSourceLabel(plannedSummary?: string | null): string {
  return plannedSummary ? `As planned: ${plannedSummary}` : "As planned";
}
