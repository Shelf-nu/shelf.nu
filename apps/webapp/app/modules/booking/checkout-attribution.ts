/**
 * Checkout-session attribution parsing (pure, no DB access).
 *
 * `PartialBookingCheckout` persists a checkout session as three POSITIONAL
 * arrays — `assetIds`, `quantities`, and `bookingAssetIds` — where index `i`
 * of each describes the SAME booked slice. This module is the single source of
 * truth for turning those raw sessions into per-asset checkout "logs" that the
 * attribution layer (`attributeDispositionsByBookingAsset`) consumes, so every
 * read site attributes identically instead of hand-rolling its own inline
 * `{ bookingAssetId, quantity }` builder.
 *
 * Positional-array contract (INVARIANT): `assetIds[i]`, `quantities[i]`, and
 * `bookingAssetIds[i]` all describe the same slice. Because Prisma `String[]`
 * cannot store `null`, the empty string `""` is the sentinel for "no specific
 * slice known → attribute greedily". Legacy rows written before the
 * `bookingAssetIds` column existed carry a missing/short array, which the
 * parser also treats as "greedy" (per-index fallback to `null`).
 *
 * @see {@link file://./service.server.ts} attributeDispositionsByBookingAsset — consumer of these logs
 * @see docs/superpowers/specs/2026-07-03-multislice-qt-checkout-fix-design.md sections D + F
 */

/**
 * One raw persisted checkout session, as stored on `PartialBookingCheckout`.
 *
 * The three arrays are positional (see module docs): element `i` of each
 * refers to the same booked slice.
 */
export type CheckoutSession = {
  /** Asset ids checked out in this session (positional with the others). */
  assetIds: string[];
  /**
   * Units checked out per slice. When aligned with `assetIds` (same length),
   * `quantities[i]` is the count for `assetIds[i]`; otherwise each slice
   * counts as a single unit (legacy INDIVIDUAL-only sessions).
   */
  quantities: number[];
  /**
   * Per-slice `BookingAsset.id`, or `""` when the writer did not know the
   * exact slice (greedy). A missing/short array (legacy rows) is treated the
   * same as all-`""`.
   */
  bookingAssetIds: string[];
};

/** A single checkout log attributed to (at most) a specific BookingAsset slice. */
export type CheckoutAttributionLog = {
  /**
   * The exact `BookingAsset.id` this checkout belongs to, or `null` when the
   * slice is unknown and the consumer should greedy-fill.
   */
  bookingAssetId: string | null;
  /** Units checked out. */
  quantity: number;
};

/**
 * Parse persisted `PartialBookingCheckout` sessions into per-asset checkout
 * logs, honoring the positional `bookingAssetIds` contract.
 *
 * For each session, each positional index `i` is processed independently:
 * - An index is included only when `isQtyAsset(assetIds[i])` is true. Callers
 *   normally pass a QT check (attribution is a QT-only concern, and INDIVIDUAL
 *   assets are reconciled by presence, not counted units), so non-QT assets are
 *   skipped — but the predicate is the sole gate: a caller MAY pass a broader
 *   predicate (e.g. `() => true`, or one scoped to a single assetId) to keep
 *   whichever assets it needs.
 * - `quantity` is `quantities[i]` when the `quantities` array is aligned with
 *   `assetIds` (equal length), falling back to `1` when it is not (legacy
 *   sessions) or when the element itself is missing.
 * - `bookingAssetId` is `bookingAssetIds[i] || null`, so both the `""`
 *   sentinel AND a missing/short array element collapse to `null` → the
 *   consumer greedy-fills that log.
 *
 * @param sessions - Raw persisted checkout sessions (positional arrays).
 * @param isQtyAsset - Inclusion predicate applied per index: an entry whose
 *   `assetId` returns `false` is skipped. Callers usually pass a
 *   QUANTITY_TRACKED check, but any predicate is honored (see above).
 * @returns Map keyed by `assetId` → the list of attribution logs for that
 *   asset across all sessions. QT assets that never appear are absent from the
 *   map.
 */
export function checkoutSessionsToLogsByAsset(
  sessions: CheckoutSession[],
  isQtyAsset: (assetId: string) => boolean
): Map<string, CheckoutAttributionLog[]> {
  const logsByAsset = new Map<string, CheckoutAttributionLog[]>();

  for (const session of sessions) {
    // Default each positional array to `[]` so a legacy/partial row that never
    // wrote `quantities` or `bookingAssetIds` (the column post-dates the row)
    // is treated as all-greedy rather than throwing on a missing array — the
    // "missing/short array" case this parser documents as supported.
    const assetIds = session.assetIds ?? [];
    const quantities = session.quantities ?? [];
    const bookingAssetIds = session.bookingAssetIds ?? [];
    // `quantities` is only trustworthy per-index when it lines up 1:1 with
    // `assetIds`; a misaligned/absent array means "one unit per slice".
    const quantitiesAligned = quantities.length === assetIds.length;

    for (let i = 0; i < assetIds.length; i++) {
      const assetId = assetIds[i];
      if (!isQtyAsset(assetId)) continue;

      const quantity = quantitiesAligned ? quantities[i] ?? 1 : 1;
      // `""` (sentinel) AND a missing/short element both fall through to null.
      const bookingAssetId = bookingAssetIds[i] || null;

      const existing = logsByAsset.get(assetId);
      if (existing) {
        existing.push({ bookingAssetId, quantity });
      } else {
        logsByAsset.set(assetId, [{ bookingAssetId, quantity }]);
      }
    }
  }

  return logsByAsset;
}

/**
 * Distributes a (booking, asset) pair's ConsumptionLog / checkout dispositions
 * across its BookingAsset rows for per-row "logged" reads.
 *
 * Logs with a non-null `bookingAssetId` are attributed exactly to
 * that row (the Polish-6+ contract). Logs with `bookingAssetId IS NULL`
 * (legacy rows + back-compat callers) are greedy-filled: standalone
 * rows first by `createdAt`, then kit-driven rows by `createdAt`, each
 * taking up to its booked quantity until the legacy pool is exhausted.
 *
 * Standalone slices fill first because loose items are scanned/returned
 * individually, whereas kits are handled as a whole — so an untagged
 * disposition is more likely the flexible standalone pool than the
 * kit's fixed allocation.
 *
 * Returns a Map<bookingAssetId, dispositionedQuantity>. Rows with no
 * attribution are present in the map with `0`.
 *
 * Pure derivation — no DB calls. Caller pre-fetches the rows and logs.
 *
 * Lives here (next to {@link checkoutSessionsToLogsByAsset}, the parser that
 * produces its input) rather than in the heavyweight `service.server.ts` so
 * pure read sites — e.g. `asset/availability.server.ts`'s batched checked-out
 * split — can consume it without dragging in the booking service's import
 * graph (and without that graph's full-module test mocks blanking it out).
 * `service.server.ts` re-exports it, so existing `~/modules/booking/service.server`
 * import sites keep working unchanged.
 *
 * @param args.bookingAssetRows - The asset's slices on the booking (`id`,
 *   booked `quantity`, and `assetKitId` discriminator).
 * @param args.consumptionLogs - The dispositions to attribute (`bookingAssetId`
 *   tag or `null` for the legacy greedy pool, plus `quantity`).
 * @returns Map keyed by every input row `id` → attributed quantity.
 */
/**
 * Order in which an untagged claim consumes an asset's slices on a booking.
 *
 * Standalone first (loose items are scanned and returned individually, whereas
 * a kit is handled as a whole, so an untagged claim is more likely the flexible
 * standalone pool than a kit's fixed allocation), then kit-driven. Within each
 * bucket by `id` ascending — `BookingAsset.id` is a cuid, whose creation-time
 * prefix sorts chronologically, standing in for a `createdAt` the model does
 * not carry.
 *
 * Exported because two things must agree on it: the quantity attribution below
 * and the `checkedOutAt` marker the checkout writer stamps. If they picked
 * different slices, a slice could hold checked-out units with no marker — which
 * the check-in guard reads as "never checked out" and refuses.
 */
export function compareSlicesForGreedyFill(
  a: { id: string; assetKitId: string | null },
  b: { id: string; assetKitId: string | null }
): number {
  const aIsKit = a.assetKitId != null;
  const bIsKit = b.assetKitId != null;
  if (aIsKit !== bIsKit) return aIsKit ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function attributeDispositionsByBookingAsset(args: {
  bookingAssetRows: Array<{
    id: string;
    quantity: number;
    assetKitId: string | null;
  }>;
  consumptionLogs: Array<{
    bookingAssetId: string | null;
    quantity: number;
  }>;
}): Map<string, number> {
  const { bookingAssetRows, consumptionLogs } = args;
  const out = new Map<string, number>();
  for (const row of bookingAssetRows) out.set(row.id, 0);

  let legacyPool = 0;
  for (const log of consumptionLogs) {
    if (log.bookingAssetId) {
      out.set(
        log.bookingAssetId,
        (out.get(log.bookingAssetId) ?? 0) + (log.quantity ?? 0)
      );
    } else {
      legacyPool += log.quantity ?? 0;
    }
  }

  if (legacyPool === 0) return out;

  const ordered = [...bookingAssetRows].sort(compareSlicesForGreedyFill);
  for (const row of ordered) {
    if (legacyPool === 0) break;
    const already = out.get(row.id) ?? 0;
    const capacity = Math.max(0, row.quantity - already);
    if (capacity === 0) continue;
    const take = Math.min(capacity, legacyPool);
    out.set(row.id, already + take);
    legacyPool -= take;
  }
  return out;
}

/**
 * How many units of each slice one checkout session sent out.
 *
 * A session's claims arrive per asset: a tagged claim names its slice, an
 * untagged one names only the asset and has to be spread. The spread runs
 * through {@link attributeDispositionsByBookingAsset} — the same primitive
 * every read site uses — once per asset, because that function's untagged pool
 * is a single bucket across the rows it is handed and would otherwise let one
 * asset's claim spill into another's slices.
 *
 * Capacity is the slice's COMMITTED REMAINING (booked total minus what earlier
 * sessions already sent), never its booked quantity. The `checkedOutAt` marker
 * caps the same way, and the two MUST agree: both walk
 * {@link compareSlicesForGreedyFill}, so a different cap makes them choose
 * different slices — leaving one slice stamped as departed with a count of zero
 * while a sibling is counted past what it booked.
 *
 * A slice missing from `committedRemainingBySlice` falls back to its booked
 * quantity. Callers seed the map for the slices they know a claim can reach,
 * and defaulting an absent one to zero would starve it — the fallback is what
 * lets a slice the caller never measured still take its share.
 *
 * Pure derivation — no DB calls.
 *
 * @param args.sliceRows - Every `BookingAsset` row on the booking.
 * @param args.committedRemainingBySlice - Units each slice has still to send.
 * @param args.claims - This session's claims, `bookingAssetId` null when untagged.
 * @returns Map of slice id → units this session sent out, zero entries omitted.
 */
export function attributeSessionCheckoutToSlices(args: {
  sliceRows: Array<{
    id: string;
    assetId: string;
    quantity: number;
    assetKitId: string | null;
  }>;
  committedRemainingBySlice: Map<string, number>;
  claims: Array<{
    assetId: string;
    bookingAssetId: string | null;
    quantity: number;
  }>;
}): Map<string, number> {
  const { sliceRows, committedRemainingBySlice, claims } = args;

  const claimsByAsset = new Map<
    string,
    Array<{ bookingAssetId: string | null; quantity: number }>
  >();
  for (const claim of claims) {
    const entries = claimsByAsset.get(claim.assetId) ?? [];
    entries.push({
      bookingAssetId: claim.bookingAssetId || null,
      quantity: claim.quantity,
    });
    claimsByAsset.set(claim.assetId, entries);
  }

  const out = new Map<string, number>();
  for (const [assetId, consumptionLogs] of claimsByAsset) {
    const spread = attributeDispositionsByBookingAsset({
      bookingAssetRows: sliceRows
        .filter((row) => row.assetId === assetId)
        .map((row) => ({
          id: row.id,
          assetKitId: row.assetKitId,
          quantity: committedRemainingBySlice.get(row.id) ?? row.quantity,
        })),
      consumptionLogs,
    });
    for (const [sliceId, units] of spread) {
      if (units > 0) out.set(sliceId, (out.get(sliceId) ?? 0) + units);
    }
  }
  return out;
}

/**
 * Units actually dispatched per ASSET on a booking, judged slice by slice.
 *
 * Two dispatch writers exist and each leaves a different record: progressive
 * scans record exact unit counts in `PartialBookingCheckout` sessions, while
 * the all-at-once checkout stamps `BookingAsset.checkedOutAt` and writes no
 * session rows. A single asset can mix both across its slices (an 8-unit
 * slice out via the button plus a later sibling scanned out progressively),
 * so neither source alone is the answer:
 * - session units judged asset-level would erase the button slices'
 *   obligation the moment ANY sibling has a session record;
 * - stamps alone would inflate a partially-dispatched progressive slice to
 *   its full booked quantity (the stamp is boolean, per slice).
 *
 * So per slice: session units attributed to that slice (tagged + greedy,
 * via {@link attributeDispositionsByBookingAsset} — the same order the
 * stamper uses) when any exist, capped by the slice's booked quantity;
 * otherwise the whole slice when it is stamped; otherwise zero. The
 * asset's dispatched units are the sum over its slices.
 *
 * Pure derivation — no DB calls; caller pre-fetches slices and sessions.
 * Consumed by completion (`isBookingFullyCheckedIn`) and by the lifecycle
 * progress loaders so the two can never disagree on what went out.
 *
 * @param args.slices - ALL of the booking's slices (`id`, `assetId`, booked
 *   `quantity`, `assetKitId`, `checkedOutAt`).
 * @param args.checkoutSessions - The booking's raw checkout sessions.
 * @returns Map keyed by `assetId` → dispatched units (absent = 0).
 */
export function computeDispatchedUnitsByAsset(args: {
  slices: Array<{
    id: string;
    assetId: string;
    quantity: number;
    assetKitId: string | null;
    checkedOutAt: Date | null;
  }>;
  checkoutSessions: CheckoutSession[];
}): Map<string, number> {
  const { slices, checkoutSessions } = args;

  const logsByAsset = checkoutSessionsToLogsByAsset(
    checkoutSessions,
    () => true
  );

  const slicesByAsset = new Map<string, typeof slices>();
  for (const s of slices) {
    const group = slicesByAsset.get(s.assetId);
    if (group) group.push(s);
    else slicesByAsset.set(s.assetId, [s]);
  }

  const dispatchedByAsset = new Map<string, number>();
  for (const [assetId, assetSlices] of slicesByAsset) {
    const sessionUnitsBySlice = attributeDispositionsByBookingAsset({
      bookingAssetRows: assetSlices.map((s) => ({
        id: s.id,
        quantity: s.quantity,
        assetKitId: s.assetKitId,
      })),
      consumptionLogs: logsByAsset.get(assetId) ?? [],
    });

    let dispatched = 0;
    for (const s of assetSlices) {
      const sessionUnits = sessionUnitsBySlice.get(s.id) ?? 0;
      if (sessionUnits > 0) {
        dispatched += Math.min(sessionUnits, s.quantity);
      } else if (s.checkedOutAt) {
        dispatched += s.quantity;
      }
    }
    if (dispatched > 0) dispatchedByAsset.set(assetId, dispatched);
  }

  return dispatchedByAsset;
}

/**
 * Units a booking has SENT OUT per ASSET, counting every departure of every
 * slice.
 *
 * Two records carry a departure and neither is complete on its own, so this
 * takes whichever accounts for more units:
 *
 * - `dispatchedByAsset` — the slice markers and the progressive sessions, via
 *   {@link computeDispatchedUnitsByAsset}. It is bounded by each slice's
 *   booked quantity, so it describes one trip and cannot describe a second.
 * - `BookingAsset.checkedOutQuantity` — cumulative across every departure, so
 *   a slice that went out, came back and went out again carries both trips.
 *
 * Whatever reads this MUST pair it with an UNCAPPED disposition sum. Pairing a
 * cumulative departure count with a per-slice-capped return count leaves a
 * fully reconciled repeat-trip row reading as still out. Both counters measure
 * the booking's whole lifetime or neither can.
 *
 * This is the one place the pairing is written down, so that the completion
 * gate ({@link isBookingFullyCheckedIn}) and the check-in the mobile booking
 * route offers cannot answer "what went out?" differently: an offer the gate
 * will not clear strands a booking on ONGOING, and a check-in the gate still
 * demands but nothing offers cannot be given at all.
 *
 * Takes `dispatchedByAsset` rather than deriving it so a caller that already
 * holds it for another purpose pays for the attribution pass once.
 * {@link computeDispatchedUnitsTotalByAsset} is the one-call form.
 *
 * @param args.slices - ALL of the booking's slices, with their stored counter.
 * @param args.dispatchedByAsset - Output of `computeDispatchedUnitsByAsset`
 *   over those same slices.
 * @returns Map keyed by `assetId` → units sent out (absent = 0).
 */
export function combineDispatchedWithStoredUnits(args: {
  slices: Array<{
    assetId: string;
    quantity: number;
    checkedOutQuantity: number | null;
  }>;
  dispatchedByAsset: Map<string, number>;
}): Map<string, number> {
  const { slices, dispatchedByAsset } = args;

  // One pass: both sums span exactly the slices `dispatchedByAsset` was built
  // from, so the three figures can never describe different row sets.
  const bookedByAsset = new Map<string, number>();
  const storedByAsset = new Map<string, number>();
  for (const s of slices) {
    bookedByAsset.set(
      s.assetId,
      (bookedByAsset.get(s.assetId) ?? 0) + s.quantity
    );
    storedByAsset.set(
      s.assetId,
      (storedByAsset.get(s.assetId) ?? 0) + (s.checkedOutQuantity ?? 0)
    );
  }

  const totalByAsset = new Map<string, number>();
  for (const [assetId, booked] of bookedByAsset) {
    // The `Math.min` restates a bound `computeDispatchedUnitsByAsset` already
    // applies slice by slice over these same slices, so it cannot bind while
    // that holds. It stays because the PAIRING is what this function promises;
    // the other helper's internals are not part of that promise.
    const units = Math.max(
      Math.min(dispatchedByAsset.get(assetId) ?? 0, booked),
      storedByAsset.get(assetId) ?? 0
    );
    if (units > 0) totalByAsset.set(assetId, units);
  }
  return totalByAsset;
}

/**
 * {@link combineDispatchedWithStoredUnits} for a caller that does not already
 * hold the per-trip dispatch figure — it runs the attribution pass itself.
 *
 * @param args.slices - ALL of the booking's slices, with their stored counter.
 * @param args.checkoutSessions - The booking's raw checkout sessions.
 * @returns Map keyed by `assetId` → units sent out (absent = 0).
 */
export function computeDispatchedUnitsTotalByAsset(args: {
  slices: Array<{
    id: string;
    assetId: string;
    quantity: number;
    assetKitId: string | null;
    checkedOutAt: Date | null;
    checkedOutQuantity: number | null;
  }>;
  checkoutSessions: CheckoutSession[];
}): Map<string, number> {
  const { slices, checkoutSessions } = args;
  return combineDispatchedWithStoredUnits({
    slices,
    dispatchedByAsset: computeDispatchedUnitsByAsset({
      slices,
      checkoutSessions,
    }),
  });
}

/**
 * Units of one asset's slices on ONE active booking that are still off the
 * shelf: what left, minus what came back or was used up.
 *
 * What left, per slice, is the larger of two records:
 * - one trip's worth, read the way {@link computeDispatchedUnitsByAsset} reads
 *   it: the slice's session claims (tagged exactly, untagged spread by
 *   {@link attributeDispositionsByBookingAsset}) capped at the booked quantity;
 *   with no claim, the whole slice when its own `checkedOutAt` is set (the
 *   all-at-once checkout stamps it and writes no session); otherwise nothing;
 * - the stored `checkedOutQuantity`. It is cumulative, so it is the one that
 *   still counts a slice sent out a second time, by either checkout.
 *
 * Never `Asset.status`: it is global, so an asset checked out on another
 * booking would read as fully out on every booking that holds a slice of it.
 *
 * What came back: the booking's RETURN / CONSUME / LOSS / DAMAGE logs for the
 * asset. A tagged log lands on its slice. An untagged one is spread standalone
 * first, each slice taking up to what it still has out. Capping by what left
 * rather than by the booked quantity is what lets a cumulative departure count
 * pair with a cumulative return count: a slice sent out twice and returned twice
 * reads zero, not one trip's worth.
 *
 * The result is clamped to `[0, quantity]` per slice.
 *
 * @param args.slices - The asset's slices on the booking.
 * @param args.checkoutClaims - This asset's session claims on the booking, as
 *   parsed by {@link checkoutSessionsToLogsByAsset}.
 * @param args.dispositions - This asset's RETURN / CONSUME / LOSS / DAMAGE logs
 *   on the booking.
 * @returns Map keyed by every slice id to the units it still has out.
 */
export function computeUnitsStillOutBySlice(args: {
  slices: Array<{
    id: string;
    quantity: number;
    assetKitId: string | null;
    checkedOutAt: Date | null;
    checkedOutQuantity: number | null;
  }>;
  checkoutClaims: CheckoutAttributionLog[];
  dispositions: CheckoutAttributionLog[];
}): Map<string, number> {
  const { slices, checkoutClaims, dispositions } = args;

  const claimedBySlice = attributeDispositionsByBookingAsset({
    bookingAssetRows: slices,
    consumptionLogs: checkoutClaims,
  });

  const departedBySlice = new Map<string, number>();
  for (const slice of slices) {
    const claimed = claimedBySlice.get(slice.id) ?? 0;
    const recorded =
      claimed > 0
        ? Math.min(slice.quantity, claimed)
        : slice.checkedOutAt
        ? slice.quantity
        : 0;
    departedBySlice.set(
      slice.id,
      Math.max(recorded, slice.checkedOutQuantity ?? 0)
    );
  }

  // Each slice's capacity for untagged returns is what it has out, so the
  // attributor is handed the departed count in place of the booked quantity.
  const disposedBySlice = attributeDispositionsByBookingAsset({
    bookingAssetRows: slices.map((slice) => ({
      id: slice.id,
      assetKitId: slice.assetKitId,
      quantity: departedBySlice.get(slice.id) ?? 0,
    })),
    consumptionLogs: dispositions,
  });

  const stillOut = new Map<string, number>();
  for (const slice of slices) {
    const departed = departedBySlice.get(slice.id) ?? 0;
    const disposed = disposedBySlice.get(slice.id) ?? 0;
    stillOut.set(
      slice.id,
      Math.min(slice.quantity, Math.max(0, departed - disposed))
    );
  }
  return stillOut;
}
