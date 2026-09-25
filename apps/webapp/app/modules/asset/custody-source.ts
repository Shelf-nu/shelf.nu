/**
 * Custody source locations for quantity-tracked assets ("pools").
 *
 * The rule: Shelf asks where units come from at the moment they LEAVE (Assign
 * for custody), once, and only when a pool is placed at two or more locations.
 * A source is a manual placement (`AssetLocation` with `assetKitId` NULL) or,
 * when the pool has units no placement accounts for, "Unplaced". The chosen
 * source is stored on `Custody.locationId` (NULL = unplaced, or never
 * recorded).
 *
 * Custody never changes a location's count. The source only decides which
 * location loses units that are used up, and caps how many can be taken from
 * a location: its placed count minus what is already in custody from it.
 *
 * Everything in this file is pure so the same numbers reach the server
 * checks, the loaders that feed the dialogs, and the unit tests. The
 * database-backed half lives in `custody-source.server.ts`.
 *
 * @see {@link file://./custody-source.server.ts}
 * @see {@link file://./placement-reconcile.server.ts}
 */

/**
 * Form value the web pickers post for "the unplaced units". Form parsing
 * drops empty strings, so the web cannot post `""`; JSON clients may send
 * `null` or `""` instead. See {@link isUnplacedSource}. Location ids are
 * cuids, so this word can never be mistaken for one.
 */
export const UNPLACED_SOURCE = "unplaced";

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

/** One manual placement of a pool. */
export type SourcePlacement = {
  locationId: string;
  quantity: number;
};

/** One operator custody row (kit-inherited rows never take part). */
export type SourceCustodyRow = {
  locationId: string | null;
  quantity: number;
};

/** What the source rules need to know about a pool. */
export type CustodySourceState = {
  /** `Asset.quantity`. */
  total: number;
  /** Manual placements only. Kit-driven rows follow their kit. */
  placements: SourcePlacement[];
  /** Operator custody rows only (`kitCustodyId` NULL). */
  operatorCustody: SourceCustodyRow[];
};

/**
 * Units no manual placement accounts for: `total - sum(placements)`, floored
 * at zero so a drifted pool (placed above total) reads as "nothing unplaced".
 */
export function unplacedUnits(state: CustodySourceState): number {
  const placed = state.placements.reduce((sum, p) => sum + p.quantity, 0);
  return Math.max(0, state.total - placed);
}

/** Units placed at `locationId`, or the unplaced units for NULL. */
export function placedAtSource(
  state: CustodySourceState,
  locationId: string | null
): number {
  if (locationId === null) return unplacedUnits(state);
  return state.placements
    .filter((p) => p.locationId === locationId)
    .reduce((sum, p) => sum + p.quantity, 0);
}

/** Units in operator custody that were taken from `locationId` (NULL included). */
export function custodyFromSource(
  state: CustodySourceState,
  locationId: string | null
): number {
  return state.operatorCustody
    .filter((row) => row.locationId === locationId)
    .reduce((sum, row) => sum + row.quantity, 0);
}

/**
 * How many units a source has left to hand out: placed there minus already in
 * custody from there. For NULL: the unplaced units minus custody recorded
 * against them. Never negative.
 *
 * This is the one definition used by the Assign cap, the dropdown's
 * pre-selection and the loss cap. It deliberately ignores booking check-outs:
 * those units carry no location, so the pool-level availability check
 * (`computeCustodyAvailability`) keeps covering them.
 */
export function unitsLeftAtSource(
  state: CustodySourceState,
  locationId: string | null
): number {
  return Math.max(
    0,
    placedAtSource(state, locationId) - custodyFromSource(state, locationId)
  );
}

/**
 * The refusal when a source has fewer units left than asked for, worded the
 * same for Assign and for a loss: "Studio has 2 pcs and 1 is already in
 * custody." or "Studio has only 2 pcs." The unplaced units are called
 * "Unplaced", as in the dropdown the operator picked them from.
 *
 * @param sourceName - The location's name, NULL for the unplaced units
 * @param placedCount - The source's units, already formatted ("2 pcs")
 * @param inCustody - Units in operator custody taken from that source
 * @returns The error's title and message
 */
export function sourceShortfall({
  sourceName,
  placedCount,
  inCustody,
}: {
  sourceName: string | null;
  placedCount: string;
  inCustody: number;
}): { title: string; message: string } {
  const where = sourceName ?? "Unplaced";
  return {
    title: sourceName
      ? "Not enough units at this location"
      : "Not enough unplaced units",
    message:
      inCustody > 0
        ? `${where} has ${placedCount} and ${inCustody} ${
            inCustody === 1 ? "is" : "are"
          } already in custody.`
        : `${where} has only ${placedCount}.`,
  };
}

/** Distinct manual placement locations, in the order given. */
export function distinctPlacementLocationIds(
  state: Pick<CustodySourceState, "placements">
): string[] {
  return Array.from(new Set(state.placements.map((p) => p.locationId)));
}

/**
 * Whether the pool is placed at two or more distinct manual locations. Every
 * new element on screen (the "From location" field, per-location custody
 * text) and every new note text is gated on this, so a pool at one location,
 * at one location plus unplaced units, or with no placement at all looks
 * exactly as it did before sources existed. Unplaced units alone never make
 * a second source: they only add an "Unplaced" option once the gate is open.
 */
export function hasMultipleSources(state: CustodySourceState): boolean {
  return distinctPlacementLocationIds(state).length >= 2;
}

/* -------------------------------------------------------------------------- */
/*                                  Options                                   */
/* -------------------------------------------------------------------------- */

/** A location as the dropdown names it. */
export type SourceLocationLabel = {
  id: string;
  name: string;
  /** Parent location name, used only to tell same-named locations apart. */
  parentName?: string | null;
};

/** One choice in a "From location" / "At location" dropdown. */
export type CustodySourceOption = {
  /** The form value: a location id, or {@link UNPLACED_SOURCE}. */
  value: string;
  /** NULL for the unplaced units. */
  locationId: string | null;
  /** "Camera Room", "Shelf A (Warehouse)" or "Unplaced". */
  label: string;
  /** Plain count placed there (or unplaced). */
  placed: number;
  /** Units in operator custody taken from there. */
  inCustody: number;
  /** {@link unitsLeftAtSource} for this option. */
  left: number;
};

/**
 * Builds the dropdown choices for a pool: one per manual placement, in
 * placement order, then "Unplaced" when the pool has unplaced units.
 *
 * Two locations with the same name get their parent's name appended so the
 * list never shows two identical lines.
 *
 * @param state - The pool's placements and operator custody
 * @param locations - Names for the placed locations, keyed by id
 */
export function buildCustodySourceOptions(
  state: CustodySourceState,
  locations: SourceLocationLabel[]
): CustodySourceOption[] {
  const byId = new Map(locations.map((l) => [l.id, l]));
  const ids = distinctPlacementLocationIds(state);

  const nameCounts = new Map<string, number>();
  for (const id of ids) {
    const name = byId.get(id)?.name.trim() ?? "";
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }

  const options: CustodySourceOption[] = ids.map((id) => {
    const location = byId.get(id);
    const name = location?.name.trim() || "Unknown location";
    const duplicated = (nameCounts.get(location?.name.trim() ?? "") ?? 0) > 1;
    const label =
      duplicated && location?.parentName
        ? `${name} (${location.parentName.trim()})`
        : name;
    return {
      value: id,
      locationId: id,
      label,
      placed: placedAtSource(state, id),
      inCustody: custodyFromSource(state, id),
      left: unitsLeftAtSource(state, id),
    };
  });

  const unplaced = unplacedUnits(state);
  if (unplaced > 0) {
    options.push({
      value: UNPLACED_SOURCE,
      locationId: null,
      label: "Unplaced",
      placed: unplaced,
      inCustody: custodyFromSource(state, null),
      left: unitsLeftAtSource(state, null),
    });
  }

  return options;
}

/** What the asset page's dialogs and rows need about a pool's sources. */
export type CustodySourceSummary = {
  /** Placed at two or more locations: the gate for every new element. */
  multiSource: boolean;
  /** Dropdown choices, empty when `multiSource` is false. */
  options: CustodySourceOption[];
  /**
   * Units the pool can hand to a custodian right now (total minus custody,
   * kits and booking check-outs): the Assign dialog's Max, the same number
   * `checkOutQuantity` enforces pool-wide.
   */
  poolAvailable: number;
};

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

/* -------------------------------------------------------------------------- */
/*                                 Resolution                                 */
/* -------------------------------------------------------------------------- */

/** How a source was decided. */
export type ResolvedCustodySource = {
  /** The location to record, NULL for unplaced / unknown. */
  locationId: string | null;
  /**
   * True when the caller named the source (a location, or "unplaced"). Only
   * an explicit source is validated and capped per location: an older phone
   * app that sends nothing must never be refused for it.
   */
  explicit: boolean;
};

/**
 * Decides which source a custody assignment records.
 *
 * 1. A submitted value wins: a location id, or the unplaced units
 *    (see {@link isUnplacedSource}).
 * 2. Nothing submitted, and the pool has exactly one manual placement and no
 *    unplaced units: that location (there is nowhere else the units can be).
 * 3. Nothing submitted otherwise (no placements, or an ambiguous pool from an
 *    older client): NULL.
 *
 * @param submitted - `undefined` when the field was absent from the request
 */
export function resolveCustodySource({
  submitted,
  state,
}: {
  submitted: string | null | undefined;
  state: CustodySourceState;
}): ResolvedCustodySource {
  if (submitted !== undefined) {
    return {
      locationId: isUnplacedSource(submitted) ? null : submitted,
      explicit: true,
    };
  }

  const locations = distinctPlacementLocationIds(state);
  if (locations.length === 1 && unplacedUnits(state) === 0) {
    return { locationId: locations[0], explicit: false };
  }

  return { locationId: null, explicit: false };
}

/* -------------------------------------------------------------------------- */
/*                                  Release                                   */
/* -------------------------------------------------------------------------- */

/** An operator custody row as the release and re-home planners see it. */
export type CustodyRowForPlan = {
  id: string;
  teamMemberId: string;
  locationId: string | null;
  quantity: number;
  createdAt: Date | string;
};

/**
 * The deterministic order rows are drawn from when the caller does not say
 * which one: the largest quantity first, then the oldest, then by id.
 */
export function orderRowsForDrain<T extends CustodyRowForPlan>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (b.quantity !== a.quantity) return b.quantity - a.quantity;
    const aTime = new Date(a.createdAt).getTime();
    const bTime = new Date(b.createdAt).getTime();
    if (aTime !== bTime) return aTime - bTime;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** One row's share of a release. */
export type ReleaseLine = {
  rowId: string;
  locationId: string | null;
  /** Units leaving this row. */
  quantity: number;
  /** How many of those were used up. */
  consumed: number;
};

/**
 * Spreads a release of `quantity` units (of which `consumed` were used up)
 * over a holder's rows in {@link orderRowsForDrain} order. Consumed units are
 * taken from the first rows drawn.
 *
 * The caller has already checked `quantity <= sum(rows)` and
 * `0 <= consumed <= quantity`.
 */
export function planDrainRelease({
  rows,
  quantity,
  consumed,
}: {
  rows: CustodyRowForPlan[];
  quantity: number;
  consumed: number;
}): ReleaseLine[] {
  const lines: ReleaseLine[] = [];
  let remaining = quantity;
  let consumedLeft = consumed;

  for (const row of orderRowsForDrain(rows)) {
    if (remaining <= 0) break;
    const take = Math.min(row.quantity, remaining);
    const lineConsumed = Math.min(take, consumedLeft);
    lines.push({
      rowId: row.id,
      locationId: row.locationId,
      quantity: take,
      consumed: lineConsumed,
    });
    remaining -= take;
    consumedLeft -= lineConsumed;
  }

  return lines;
}

/* -------------------------------------------------------------------------- */
/*                                  Re-home                                   */
/* -------------------------------------------------------------------------- */

/** One re-home step: `quantity` units of a row now belong somewhere else. */
export type RehomeMove = {
  rowId: string;
  teamMemberId: string;
  fromLocationId: string | null;
  toLocationId: string | null;
  quantity: number;
};

/**
 * Plans how custody follows a placement change, without ever refusing it.
 *
 * When a location ends up holding fewer units than are in custody from it,
 * the excess custody moves: to `destinationLocationId` when the change has a
 * single destination with room (a move, or a whole-pool relocation), else to
 * NULL (the units become unplaced). Units that were not in custody leave a
 * location first, so custody only moves once the free units run out.
 *
 * Only excess CREATED by this change moves. A location that already had more
 * custody than units before the change keeps that difference; the same goes
 * for the unplaced pile.
 *
 * The unplaced pile shrinking (units placed from it) re-homes NULL custody
 * only when `destinationLocationId` is given: with several receiving
 * locations the source of those units is unknown, so it stays unrecorded.
 *
 * @param before - The pool as it was, read under the asset lock
 * @param after - The pool as it is after the placement write
 * @param rows - Operator custody rows (with ids) of the pool
 * @param destinationLocationId - The one location the change sends units to
 */
export function planCustodyRehome({
  before,
  after,
  rows,
  destinationLocationId,
}: {
  before: CustodySourceState;
  after: CustodySourceState;
  rows: CustodyRowForPlan[];
  destinationLocationId?: string | null;
}): RehomeMove[] {
  const moves: RehomeMove[] = [];
  const custodyState: CustodySourceState = {
    total: after.total,
    placements: after.placements,
    operatorCustody: rows,
  };

  /** Units moved INTO each target so far, so room shrinks as we go. */
  const movedInto = new Map<string | null, number>();

  const roomAt = (locationId: string): number =>
    Math.max(
      0,
      placedAtSource(after, locationId) -
        custodyFromSource(custodyState, locationId) -
        (movedInto.get(locationId) ?? 0)
    );

  const excessFor = (locationId: string | null): number => {
    const inCustody = custodyFromSource(custodyState, locationId);
    const excessAfter = Math.max(
      0,
      inCustody - placedAtSource(after, locationId)
    );
    const excessBefore = Math.max(
      0,
      inCustody - placedAtSource(before, locationId)
    );
    return Math.max(0, excessAfter - excessBefore);
  };

  const takeFromRows = (
    fromLocationId: string | null,
    amount: number,
    pickTarget: (remaining: number) => {
      toLocationId: string | null;
      quantity: number;
    }
  ) => {
    let remaining = amount;
    const sourceRows = orderRowsForDrain(
      rows.filter((row) => row.locationId === fromLocationId)
    );
    for (const row of sourceRows) {
      let rowLeft = row.quantity;
      while (remaining > 0 && rowLeft > 0) {
        const target = pickTarget(Math.min(remaining, rowLeft));
        if (target.quantity <= 0) return;
        moves.push({
          rowId: row.id,
          teamMemberId: row.teamMemberId,
          fromLocationId,
          toLocationId: target.toLocationId,
          quantity: target.quantity,
        });
        movedInto.set(
          target.toLocationId,
          (movedInto.get(target.toLocationId) ?? 0) + target.quantity
        );
        remaining -= target.quantity;
        rowLeft -= target.quantity;
      }
      if (remaining <= 0) return;
    }
  };

  const locationIds = Array.from(
    new Set(
      rows
        .map((row) => row.locationId)
        .filter((id): id is string => id !== null)
    )
  ).sort();

  for (const locationId of locationIds) {
    const excess = excessFor(locationId);
    if (excess <= 0) continue;

    takeFromRows(locationId, excess, (want) => {
      if (destinationLocationId && destinationLocationId !== locationId) {
        const room = roomAt(destinationLocationId);
        if (room > 0) {
          return {
            toLocationId: destinationLocationId,
            quantity: Math.min(want, room),
          };
        }
      }
      return { toLocationId: null, quantity: want };
    });
  }

  if (destinationLocationId) {
    const excess = excessFor(null);
    if (excess > 0) {
      takeFromRows(null, excess, (want) => ({
        toLocationId: destinationLocationId,
        quantity: Math.min(want, roomAt(destinationLocationId)),
      }));
    }
  }

  return moves;
}

/* -------------------------------------------------------------------------- */
/*                                 API shape                                  */
/* -------------------------------------------------------------------------- */

/** One source of a holder's units, as the mobile API reports it. */
export type CustodySourceEntry = {
  /** NULL: the unplaced units, or a source that was never recorded. */
  locationId: string | null;
  /** The location's name; null with `locationId`. */
  name: string | null;
  /** Units the holder took from this source. */
  quantity: number;
};

/**
 * A holder's operator rows as per-source entries, one per source location,
 * in the order the rows were given. Rows sharing a source (never the case
 * under the operator unique index, but cheap to guard) are summed.
 *
 * @param rows - One holder's operator custody rows (no kit-inherited ones)
 */
export function buildCustodySourceEntries(
  rows: Array<{
    quantity: number;
    location: { id: string; name: string } | null;
  }>
): CustodySourceEntry[] {
  const entries: CustodySourceEntry[] = [];
  for (const row of rows) {
    const locationId = row.location?.id ?? null;
    const existing = entries.find((entry) => entry.locationId === locationId);
    if (existing) {
      existing.quantity += row.quantity;
    } else {
      entries.push({
        locationId,
        name: row.location?.name ?? null,
        quantity: row.quantity,
      });
    }
  }
  return entries;
}
