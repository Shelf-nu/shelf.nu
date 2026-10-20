/**
 * Custody source vocabulary shared by the webapp and the companion app.
 *
 * A pool placed at two or more locations is asked where its units come from
 * when they leave. This module owns the parts both apps must agree on, so the
 * phone and the web pre-select the same location and describe a source in the
 * same words:
 *
 * - the picker values for "the unplaced units" and "a source never recorded";
 * - the shape of one "From location" option and which option a dialog opens on;
 * - the shape of one source of a holder's units and how it is described.
 *
 * The numbers themselves (placed, in custody, left) are computed on the server
 * from the database (`apps/webapp/app/modules/asset/custody-source.ts`), which
 * also enforces every cap. Nothing here gates anything the server does not
 * check again.
 *
 * @see {@link file://../../../apps/webapp/app/modules/asset/custody-source.ts}
 * @see {@link file://../../../apps/companion/lib/custody-source-options.ts}
 */

/**
 * Picker value for "the unplaced units". Form parsing drops empty strings, so
 * the web cannot post `""`; JSON clients may send `null` or `""` instead. See
 * {@link isUnplacedSource}. Location ids are cuids, so this word can never be
 * mistaken for one.
 */
export const UNPLACED_SOURCE = "unplaced";

/**
 * Release value for custody whose source was never recorded. Like
 * {@link UNPLACED_SOURCE} it can never be mistaken for a location id.
 */
export const UNRECORDED_SOURCE = "unrecorded";

/**
 * Whether a submitted source names the unplaced units: `null`, `""` or
 * {@link UNPLACED_SOURCE}. `undefined` is NOT one of them: it means the
 * caller did not say.
 */
export function isUnplacedSource(
  value: string | null | undefined
): value is null | "" | typeof UNPLACED_SOURCE {
  return value === null || value === "" || value === UNPLACED_SOURCE;
}

/**
 * The value a release names a custody row's source by: its location id,
 * {@link UNPLACED_SOURCE}, or {@link UNRECORDED_SOURCE}.
 */
export function custodySourceKey(row: {
  locationId: string | null;
  sourceUnknown: boolean;
}): string {
  if (row.locationId !== null) return row.locationId;
  return row.sourceUnknown ? UNRECORDED_SOURCE : UNPLACED_SOURCE;
}

/* -------------------------------------------------------------------------- */
/*                                  Options                                   */
/* -------------------------------------------------------------------------- */

/** One choice in a "From location" / "At location" picker. */
export type CustodySourceOption = {
  /** The submitted value: a location id, or {@link UNPLACED_SOURCE}. */
  value: string;
  /** NULL for the unplaced units. */
  locationId: string | null;
  /** "Camera Room", "Shelf A (Warehouse)" or "Unplaced". */
  label: string;
  /** Plain count placed there (or unplaced). */
  placed: number;
  /** Units in operator custody taken from there. */
  inCustody: number;
  /** Units out on a booking that left from there. */
  onBooking: number;
  /** Units that can still be taken from there. */
  left: number;
};

/**
 * What an option has already committed, as the pickers print it after the
 * placed count: `["1 in custody", "10 on a booking"]`. Empty when nothing is.
 */
export function sourceCommitmentParts(
  option: Pick<CustodySourceOption, "inCustody" | "onBooking">
): string[] {
  const parts: string[] = [];
  if (option.inCustody > 0) parts.push(`${option.inCustody} in custody`);
  if (option.onBooking > 0) parts.push(`${option.onBooking} on a booking`);
  return parts;
}

/**
 * The option a dialog opens with: the LOCATION with the most units left.
 * "Unplaced" is never the default, even when it has more left; the operator
 * picks it on purpose. Ties go to the earlier location, so the choice is
 * stable between renders. NULL only when there is no location option.
 */
export function defaultSourceOption(
  options: CustodySourceOption[]
): CustodySourceOption | null {
  let best: CustodySourceOption | null = null;
  for (const option of options) {
    if (option.locationId === null) continue;
    if (!best || option.left > best.left) best = option;
  }
  return best;
}

/**
 * The option an ASSIGN opens with. Same as {@link defaultSourceOption} while
 * some location has units left. When none does, it is "Unplaced" if the
 * unplaced units have some left: pre-selecting a location with nothing left
 * would refuse an assignment the pool can give. Falls back to the location
 * default when nothing has units left anywhere.
 *
 * Adjust keeps {@link defaultSourceOption}: a restock lands at a location,
 * and units left says nothing about where stock arrives.
 *
 * @param options - The pool's options, in placement order
 * @returns The option to pre-select, NULL when there is no location option
 */
export function defaultAssignSourceOption(
  options: CustodySourceOption[]
): CustodySourceOption | null {
  const location = defaultSourceOption(options);
  if (location && location.left > 0) return location;
  const unplaced = options.find((option) => option.locationId === null);
  return unplaced && unplaced.left > 0 ? unplaced : location;
}

/* -------------------------------------------------------------------------- */
/*                              Holder's sources                              */
/* -------------------------------------------------------------------------- */

/** One source of a holder's units. */
export type CustodySourceEntry = {
  /** NULL: the unplaced units, or (with `unrecorded`) a source never recorded. */
  locationId: string | null;
  /** True when the source was never recorded; always false with a location. */
  unrecorded: boolean;
  /** The location's name; null without `locationId`. */
  name: string | null;
  /** Units the holder took from this source. */
  quantity: number;
};

/**
 * What a source without a location means, in running text: the unplaced
 * units, or, when `unrecorded` is set, a source that was never recorded.
 */
export function nullSourceLabel(unrecorded: boolean): string {
  return unrecorded ? "location not recorded" : "unplaced";
}

/**
 * The name of a source as a picker row or a release line heads it:
 * "Camera Room", "Unplaced" or "Location not recorded".
 */
export function sourceEntryLabel(
  entry: Pick<CustodySourceEntry, "locationId" | "unrecorded" | "name">
): string {
  if (entry.locationId !== null) return entry.name ?? "Unknown location";
  return entry.unrecorded ? "Location not recorded" : "Unplaced";
}

/** One part of a holder's source text. */
export type SourcePart = {
  /** Stable key: the source's location id, "unplaced" or "unrecorded". */
  key: string;
  text: string;
  /** Rendered lighter: the source was never recorded. */
  muted: boolean;
};

/**
 * The source text after a holder's quantity: "from Studio" for a single
 * source, "2 from Camera Room", "1 from Studio" for several, "unplaced" /
 * "location not recorded" without a location. Empty for no entries.
 *
 * @param entries - The holder's sources, in the order they should read
 */
export function describeCustodySourceParts(
  entries: CustodySourceEntry[]
): SourcePart[] {
  const single = entries.length === 1;
  return entries.map((entry) => {
    const key = custodySourceKey({
      locationId: entry.locationId,
      sourceUnknown: entry.unrecorded,
    });
    const muted = entry.locationId === null && entry.unrecorded;
    const where =
      entry.locationId !== null
        ? `from ${entry.name ?? "Unknown location"}`
        : nullSourceLabel(entry.unrecorded);
    return { key, text: single ? where : `${entry.quantity} ${where}`, muted };
  });
}
