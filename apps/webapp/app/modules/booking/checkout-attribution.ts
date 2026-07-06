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
