/**
 * Booking source display: turns a slice's (or a booking line's) source rows
 * into labelled parts and a one-line summary such as
 * "Demo Warehouse 8 · Unplaced 7".
 *
 * KIT rows never appear (kit units keep their own display). Rows with nothing
 * planned and nothing out are hidden, so a history-only UNKNOWN carrier shows
 * nothing. Rows of the same source are summed.
 *
 * @see {@link file://./booking-sources.ts} for the row model and source keys.
 */

import { sourceKey, type SourceRowState } from "./booking-sources";

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
 * @returns Parts ordered by location name, then Unplaced, Unknown, Needs a location
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
      a.label.localeCompare(b.label) ||
      a.key.localeCompare(b.key)
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
