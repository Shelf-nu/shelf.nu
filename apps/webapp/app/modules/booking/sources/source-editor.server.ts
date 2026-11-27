/**
 * Source editor reader
 *
 * Read-only loader helper for the "From" section of the adjust quantity
 * dialog: the loose sources of one standalone pool slice, with the units it
 * has pending and out at each, and the units free there over the booking
 * window for this booking.
 *
 * The section applies only to a standalone slice (no kit link) of a pool
 * with at least one manual placement, allocated by source (AUTO or MANUAL),
 * on a booking that is still open. Everything else gets `null`, decided from
 * the slice the caller already read, so a LEGACY slice costs no query here.
 *
 * Units held at a location that is no longer a placement of the pool are
 * listed apart (`stranded`); while any exist the section is read-only and
 * offers only Auto, because a MANUAL request cannot name that location.
 *
 * No lock is taken: the figures are a preview. The adjust action re-reads
 * and admits under its locks.
 *
 * @see {@link file://./source-editor.ts} the data shape and the split rules
 * @see {@link file://./capacity.server.ts} free units per source
 * @see {@link file://../../../routes/api+/bookings.$bookingId.adjust-asset-quantity.ts} the loader
 */

import { sourceKey } from "@shelf/quantity-control";
import { db } from "~/database/db.server";

import { computeFreeBySourceForPools } from "./capacity.server";
import type {
  SourceEditorData,
  SourceEditorRow,
  StrandedSource,
} from "./source-editor";

/** Booking statuses whose slices can still change sources. */
const EDITABLE_STATUSES: ReadonlySet<string> = new Set([
  "DRAFT",
  "RESERVED",
  "ONGOING",
  "OVERDUE",
]);

/** The slice's mode when the editor can act on it (AUTO or MANUAL). */
function editableMode(mode: string): SourceEditorData["mode"] | null {
  return mode === "AUTO" || mode === "MANUAL" ? mode : null;
}

/** The slice as the caller already read it. */
export type SourceEditorSlice = {
  /** `BookingAsset.id`. */
  id: string;
  assetId: string;
  /** Set when the slice came with a kit (kit residue keeps its own rules). */
  sourceKitId: string | null;
  /** `BookingAsset.sourceAllocation`. */
  sourceAllocation: string;
  /** True for a QUANTITY_TRACKED asset. */
  isPool: boolean;
  booking: { status: string; from: Date; to: Date };
};

/**
 * Reads the From section of one standalone pool slice.
 *
 * Queries, only once the slice qualifies: free units per source (five) and
 * the slice's source rows (one) in parallel, then location names (one,
 * placements and former placements together).
 *
 * @param args.organizationId - The trusted workspace id
 * @param args.bookingId - The booking (its own holds are not competition)
 * @param args.slice - The standalone slice, already read by the caller
 * @returns The editor data, or null when the section does not apply
 */
export async function getSourceEditorData(args: {
  organizationId: string;
  bookingId: string;
  slice: SourceEditorSlice;
}): Promise<SourceEditorData | null> {
  const { organizationId, bookingId, slice } = args;
  if (!slice.isPool || slice.sourceKitId) return null;
  const mode = editableMode(slice.sourceAllocation);
  if (!mode) return null;
  if (!EDITABLE_STATUSES.has(slice.booking.status)) return null;

  // The window the adjust action admits over: the booking's own dates.
  const window = { from: slice.booking.from, to: slice.booking.to };
  const [freeByPool, rows] = await Promise.all([
    computeFreeBySourceForPools(db, {
      organizationId,
      assetIds: [slice.assetId],
      window,
      excludeBookingId: bookingId,
    }),
    db.bookingAssetSource.findMany({
      where: { organizationId, bookingAssetId: slice.id },
      select: {
        kind: true,
        locationId: true,
        quantity: true,
        outQuantity: true,
        releasedQuantity: true,
      },
    }),
  ]);

  const free = freeByPool.get(slice.assetId) ?? [];
  const placements = free.filter((s) => s.kind === "LOCATION");
  // A pool without manual placements has one source (Unplaced): nothing to split.
  if (placements.length === 0) return null;

  // Pending and out per loose source; "Needs a location" and unknown origins apart.
  const pendingByKey = new Map<string, number>();
  const outByKey = new Map<string, number>();
  let unassignedPending = 0;
  let unknownOut = 0;
  for (const row of rows) {
    const pending = Math.max(
      0,
      row.quantity - row.releasedQuantity - row.outQuantity
    );
    if (row.kind === "UNASSIGNED") {
      unassignedPending += pending;
      continue;
    }
    if (row.kind === "UNKNOWN") {
      unknownOut += row.outQuantity;
      continue;
    }
    if (row.kind !== "LOCATION" && row.kind !== "UNPLACED") continue;
    const key = sourceKey(row);
    pendingByKey.set(key, (pendingByKey.get(key) ?? 0) + pending);
    outByKey.set(key, (outByKey.get(key) ?? 0) + row.outQuantity);
  }

  // Locations the slice still holds units at that are no longer placements:
  // a MANUAL split cannot name them, so they lock the section.
  const placementIds = new Set(
    placements.flatMap((s) => (s.locationId ? [s.locationId] : []))
  );
  const strandedIds = [
    ...new Set(
      rows.flatMap((row) =>
        row.kind === "LOCATION" &&
        row.locationId &&
        !placementIds.has(row.locationId)
          ? [row.locationId]
          : []
      )
    ),
  ].filter((locationId) => {
    const key = sourceKey({ kind: "LOCATION", locationId });
    return (pendingByKey.get(key) ?? 0) + (outByKey.get(key) ?? 0) > 0;
  });

  const locations = await db.location.findMany({
    where: { id: { in: [...placementIds, ...strandedIds] }, organizationId },
    select: { id: true, name: true },
  });
  const names = new Map(locations.map((l) => [l.id, l.name]));
  const nameOf = (locationId: string | null) =>
    (locationId && names.get(locationId)) || "Unknown location";

  const stranded: StrandedSource[] = strandedIds
    .map((locationId) => {
      const key = sourceKey({ kind: "LOCATION", locationId });
      return {
        key,
        locationId,
        label: nameOf(locationId),
        pending: pendingByKey.get(key) ?? 0,
        out: outByKey.get(key) ?? 0,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));

  const toRow = (
    source: (typeof free)[number],
    label: string
  ): SourceEditorRow => {
    const key = sourceKey(source);
    return {
      key,
      locationId: source.locationId,
      label,
      pending: pendingByKey.get(key) ?? 0,
      out: outByKey.get(key) ?? 0,
      free: source.free,
    };
  };

  const locationRows = placements
    .map((s) => toRow(s, nameOf(s.locationId)))
    .sort((a, b) => a.label.localeCompare(b.label));
  const unplaced = free.find((s) => s.kind === "UNPLACED");

  return {
    sliceId: slice.id,
    mode,
    rows: unplaced
      ? [...locationRows, toRow(unplaced, "Unplaced")]
      : locationRows,
    unassignedPending,
    unknownOut,
    stranded,
  };
}
