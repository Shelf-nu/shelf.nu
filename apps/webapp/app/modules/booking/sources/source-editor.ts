/**
 * Source editor model
 *
 * The data and the pure rules behind the "From" section of the adjust
 * quantity dialog, where a standalone pool slice's units are split across
 * the pool's loose sources (its manual placements and Unplaced).
 *
 * The operator edits the units each source still has to send out (pending).
 * Units already out stay where they are, so the request this module builds
 * sends, per source, the planned units the server expects: out plus pending.
 * The pending units must add up to the slice's pending units after the
 * quantity change: units waiting on "Needs a location" must be placed, and
 * units out from an unknown source are never part of the split.
 *
 * Client-safe: no server imports, so the dialog and the loader share it.
 *
 * @see {@link file://./source-editor.server.ts} the loader-side reader
 * @see {@link file://./sources-input.ts} the request schema the result matches
 * @see {@link file://../../../components/booking/booking-source-editor.tsx} the UI
 */

import type { BookingSourcesInput } from "./sources-input";

/**
 * Key prefix of the fetcher that loads a slice's From section (followed by
 * the booking and asset ids). The section shows nothing until it loads, so
 * the global progress bar stays off for it.
 */
export const SOURCE_EDITOR_FETCHER_KEY_PREFIX = "adjust-booking-asset-sources-";

/** One loose source of the pool, as the From section shows it. */
export type SourceEditorRow = {
  /** Stable key: `LOCATION:{id}` or `UNPLACED:`. */
  key: string;
  /** The placement's location id, or null for Unplaced. */
  locationId: string | null;
  /** Location name, or "Unplaced". */
  label: string;
  /** Units this slice still has to send out from here. */
  pending: number;
  /** Units of this slice out from here right now (not editable). */
  out: number;
  /** Units free here over the booking window for this booking. */
  free: number;
};

/**
 * Units of the slice held at a location that is no longer a manual placement
 * of the pool. They cannot be named in a split, so the section is read-only
 * while any exist (see {@link isSplitLocked}).
 */
export type StrandedSource = {
  /** `LOCATION:{id}`. */
  key: string;
  locationId: string;
  /** Location name, or "Unknown location". */
  label: string;
  /** Units still to go out from there. */
  pending: number;
  /** Units out from there right now. */
  out: number;
};

/** What the From section needs for one standalone pool slice. */
export type SourceEditorData = {
  /** The slice (`BookingAsset.id`). */
  sliceId: string;
  /** How the slice's sources are chosen today. */
  mode: "AUTO" | "MANUAL";
  /** Every manual placement of the pool by name, then Unplaced. */
  rows: SourceEditorRow[];
  /** Pending units on "Needs a location", to be placed by the split. */
  unassignedPending: number;
  /** Units out from an unknown source: shown, never part of the split. */
  unknownOut: number;
  /** Units held at former placements; any entry locks the split. */
  stranded: StrandedSource[];
};

/**
 * True when the split cannot be edited by hand: some units sit at a
 * location that is no longer a placement, which a MANUAL request cannot
 * name. Only Auto (back to the allocation rule) is offered then.
 */
export function isSplitLocked(editor: SourceEditorData): boolean {
  return editor.stranded.length > 0;
}

/** Raw input text per source key, as typed by the operator. */
export type SourceSplitValues = Record<string, string>;

/** Pending units of the slice that the split places today. */
export function pendingTotal(editor: SourceEditorData): number {
  return (
    editor.rows.reduce((sum, row) => sum + row.pending, 0) +
    editor.unassignedPending
  );
}

/** True when some unit of the slice is out from one of its sources. */
export function hasUnitsOut(editor: SourceEditorData): boolean {
  return editor.rows.some((row) => row.out > 0) || editor.unknownOut > 0;
}

/**
 * Pending units the split must add up to once the quantity changes by
 * `quantityDelta` (an increase adds pending units, a decrease removes them).
 *
 * @param editor - The slice's editor data
 * @param quantityDelta - New quantity minus the current one
 * @returns The required total of the pending inputs
 */
export function requiredPending(
  editor: SourceEditorData,
  quantityDelta: number
): number {
  return pendingTotal(editor) + quantityDelta;
}

/**
 * The inputs' starting text: each source's pending units today.
 *
 * @param editor - The slice's editor data
 * @returns Input text per source key
 */
export function initialSplitValues(
  editor: SourceEditorData
): SourceSplitValues {
  return Object.fromEntries(
    editor.rows.map((row) => [row.key, String(row.pending)])
  );
}

/** Outcome of {@link resolveManualSources}. */
export type ResolvedSources =
  | { ok: true; input: BookingSourcesInput }
  | { ok: false; message: string };

/**
 * Checks the typed split and builds the MANUAL sources request.
 *
 * Every input must be a whole number of at least 0. A blank input is no
 * answer, not a zero, so it is refused rather than read as 0. The inputs
 * must add up to {@link requiredPending}. Each source is sent
 * with its planned units (out plus pending); sources with nothing planned
 * are left out, which the server reads as 0. When every source is empty the
 * first one is still sent, because the request needs at least one entry.
 *
 * @param args.editor - The slice's editor data
 * @param args.values - Input text per source key
 * @param args.quantityDelta - New quantity minus the current one
 * @param args.unitLabel - Unit word for the messages ("units", "pcs")
 * @returns The request, or the message to show
 */
export function resolveManualSources(args: {
  editor: SourceEditorData;
  values: SourceSplitValues;
  quantityDelta: number;
  unitLabel?: string;
}): ResolvedSources {
  const { editor, values, quantityDelta, unitLabel = "units" } = args;
  const required = requiredPending(editor, quantityDelta);
  if (required < 0) {
    return {
      ok: false,
      message: "The quantity cannot go below the units already out.",
    };
  }

  const entries: Array<{ locationId: string | null; quantity: number }> = [];
  let sum = 0;
  for (const row of editor.rows) {
    const text = (values[row.key] ?? "").trim();
    // Blank is decided before parsing: `Number("")` would turn it into 0.
    if (text === "") {
      return {
        ok: false,
        message: `Enter ${unitLabel} for every source, 0 for none.`,
      };
    }
    const pending = Number(text);
    if (!Number.isInteger(pending) || pending < 0) {
      return {
        ok: false,
        message: `Each source needs a whole number of ${unitLabel}, 0 or more.`,
      };
    }
    sum += pending;
    const planned = row.out + pending;
    if (planned > 0) {
      entries.push({ locationId: row.locationId, quantity: planned });
    }
  }

  if (sum !== required) {
    return {
      ok: false,
      message: hasUnitsOut(editor)
        ? `The ${unitLabel} still to go out must add up to ${required}.`
        : `The sources must add up to ${required} ${unitLabel}.`,
    };
  }

  if (entries.length === 0 && editor.rows.length > 0) {
    entries.push({ locationId: editor.rows[0].locationId, quantity: 0 });
  }
  return { ok: true, input: { mode: "MANUAL", sources: entries } };
}
