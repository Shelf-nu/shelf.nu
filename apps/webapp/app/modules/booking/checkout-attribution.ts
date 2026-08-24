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

  // Greedy fill: standalone-first (loose items are scanned individually;
  // kits are handled as a whole), then kit-driven. Within each bucket,
  // sort by `id` ascending — BookingAsset.id is a cuid, which is
  // chronologically sortable (creation-time prefix), so this stands in
  // for "by createdAt" without needing the column on the model.
  const ordered = [...bookingAssetRows].sort((a, b) => {
    const aIsKit = a.assetKitId != null;
    const bIsKit = b.assetKitId != null;
    if (aIsKit !== bIsKit) return aIsKit ? 1 : -1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
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
