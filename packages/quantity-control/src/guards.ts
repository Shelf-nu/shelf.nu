/**
 * `@shelf/quantity-control` — pure quantity guards (verdicts, not throws).
 *
 * The DECISIONS behind the webapp's availability write guards, stripped of all
 * Prisma / transaction / `ShelfError` coupling. Each function takes the
 * already-resolved numbers (the app fetches them under a row lock) and returns
 * a {@link QuantityVerdict} — a plain data verdict the adapter turns into a
 * throw (`throw new ShelfError({ message: verdict.message, status: 400 })`) or
 * a client-side validation message. This mirrors the hexagonal split: the pure
 * domain decides, the app performs I/O and side-effects.
 *
 * Extracted from `assertAssetQuantityAvailable` /
 * `assertAssetQuantitiesAvailable` (directional booking-side guards) and
 * `assertAssetQuantityNotBelowReservations` (the stock-lowering guard) in the
 * webapp's asset-availability modules.
 *
 * @see {@link file://./availability.ts}
 * @see {@link file://./types.ts}
 */

import { computeAvailability } from "./availability.js";
import type { AvailabilityInputs } from "./types.js";

/* -------------------------------------------------------------------------- */
/*                                  Verdicts                                  */
/* -------------------------------------------------------------------------- */

/**
 * The outcome of a pure quantity check. `ok: true` means "allowed"; `ok:
 * false` carries the `shortfall` (units over the pool) and a ready-to-surface
 * `message`.
 */
export type QuantityVerdict =
  | { ok: true }
  | { ok: false; shortfall: number; message: string };

/* -------------------------------------------------------------------------- */
/*                        buildInsufficientStockMessage                       */
/* -------------------------------------------------------------------------- */

/**
 * Standardized copy for an insufficient-availability rejection, so the
 * shortfall message reads identically wherever it appears (server error,
 * client-side validation fallback). `bookable` is signed; the sentence clamps
 * it to 0 for display.
 *
 * @param args.assetTitle - The asset's title (omitted → generic phrasing).
 * @param args.requested - Units the caller asked for.
 * @param args.bookable - Signed bookable units (clamped to 0 for the sentence).
 * @param args.unitOfMeasure - The asset's unit; falls back to "units".
 * @returns The exact shortfall sentence.
 */
export function buildInsufficientStockMessage(args: {
  assetTitle?: string;
  requested: number;
  bookable: number;
  unitOfMeasure?: string | null;
}): string {
  const { assetTitle, requested, bookable, unitOfMeasure } = args;
  // Trim so a blank/whitespace unit (user-entered fields allow it) falls back
  // to "units" instead of rendering "Only 2   available".
  const unit = unitOfMeasure?.trim() || "units";
  const available = Math.max(0, bookable);
  const forAsset = assetTitle ? ` for "${assetTitle}"` : "";
  return `Only ${available} ${unit} available${forAsset} in this window — you requested ${requested}. Reduce the quantity to continue.`;
}

/* -------------------------------------------------------------------------- */
/*                           checkQuantityAvailable                           */
/* -------------------------------------------------------------------------- */

/** One asset's requested-quantity check against its resolved `bookable`. */
export type QuantityCheckItem = {
  /** The row's quantity as submitted by the caller. */
  requestedQuantity: number;
  /**
   * The row's existing quantity for this booking/asset before this
   * submission. Defaults to `0` — a brand-new booking has nothing existing to
   * compare against, so its request is checked ABSOLUTELY.
   */
  currentQuantity?: number;
  /**
   * The signed `bookable` for this asset over the target window, EXCLUDING
   * this booking's own reservation — the absolute maximum this booking may
   * hold given every OTHER overlapping commitment.
   */
  bookable: number;
  /** Asset title, surfaced in the message + shortfall detail. */
  assetTitle?: string;
  /** Asset's unit of measure, used in the message. */
  unitOfMeasure?: string | null;
};

/**
 * Directional availability check for a single asset's quantity on a booking.
 *
 * A reduction (`requestedQuantity <= currentQuantity`) can never oversubscribe
 * the pool and always passes — the #2725 recovery rule: an already-over-
 * committed booking can still be edited back down. Only an INCREASE is
 * measured, and it competes against the FULL `bookable` (not just the delta),
 * because `bookable` already excludes this booking's own reservation.
 *
 * @param item - The requested/current quantities + resolved `bookable`.
 * @returns `{ ok: true }` for a reduction/no-op or a fitting increase;
 *   otherwise `{ ok: false, shortfall, message }`.
 */
export function checkQuantityAvailable(
  item: QuantityCheckItem
): QuantityVerdict {
  const current = item.currentQuantity ?? 0;
  // A reduction (or no-op) can never oversubscribe the pool → always allowed.
  if (item.requestedQuantity <= current) return { ok: true };

  if (item.requestedQuantity > item.bookable) {
    const available = Math.max(0, item.bookable);
    return {
      ok: false,
      shortfall: item.requestedQuantity - available,
      message: buildInsufficientStockMessage({
        assetTitle: item.assetTitle,
        requested: item.requestedQuantity,
        bookable: item.bookable,
        unitOfMeasure: item.unitOfMeasure,
      }),
    };
  }

  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/*                          checkQuantitiesAvailable                          */
/* -------------------------------------------------------------------------- */

/** Aggregated result of a multi-asset availability check. */
export type QuantitiesVerdict = {
  ok: boolean;
  /** Present only when `ok` is false — one multi-line message covering every shortfall. */
  message?: string;
  /** One entry per asset whose increase exceeded availability (empty when `ok`). */
  shortfalls: Array<{
    assetTitle?: string;
    shortfall: number;
    bookable: number;
  }>;
};

/**
 * Batched sibling of {@link checkQuantityAvailable}: applies the same
 * directional rule to MANY assets and aggregates every shortfall into ONE
 * message, so the operator sees every asset that needs adjusting in one pass.
 * The adapter resolves each item's `bookable` from a single batched
 * availability read before calling this.
 *
 * @param items - The assets + requested/current quantities to validate.
 * @returns `{ ok: true, shortfalls: [] }` when everything fits; otherwise
 *   `{ ok: false, message, shortfalls }`.
 */
export function checkQuantitiesAvailable(
  items: QuantityCheckItem[]
): QuantitiesVerdict {
  const shortfalls: QuantitiesVerdict["shortfalls"] = [];

  for (const item of items) {
    const verdict = checkQuantityAvailable(item);
    if (!verdict.ok) {
      shortfalls.push({
        assetTitle: item.assetTitle,
        shortfall: verdict.shortfall,
        bookable: item.bookable,
      });
    }
  }

  if (shortfalls.length === 0) return { ok: true, shortfalls };

  const lines = shortfalls.map((s) => {
    const title = s.assetTitle ?? "Asset";
    const available = Math.max(0, s.bookable);
    return `"${title}": short by ${s.shortfall} — only ${available} available in this window`;
  });

  return {
    ok: false,
    shortfalls,
    message: `Some quantity-tracked assets don't fit the pool for these dates:\n${lines.join(
      "\n"
    )}\nPlease reduce the quantities before continuing.`,
  };
}

/* -------------------------------------------------------------------------- */
/*                       checkQuantityNotBelowCommitted                       */
/* -------------------------------------------------------------------------- */

/** Inputs for the stock-lowering check. */
export type CommittedCheck = {
  /** The asset's total quantity as it would be AFTER this write. */
  newTotal: number;
  /** Units already committed (custody + kits + peak concurrent reservations). */
  committed: number;
  /** Asset title, used in the rejection message. */
  assetTitle?: string;
  /** Asset's unit of measure, used in the rejection message. */
  unitOfMeasure?: string | null;
};

/**
 * STOCK-LOWERING check: blocks reducing an asset's total quantity below what
 * is ALREADY committed elsewhere (operator custody, kit allocations, or the
 * peak concurrent booking demand). The mirror image of
 * {@link checkQuantityAvailable}: that polices a booking's request against the
 * pool; this polices the asset's total against everything drawing from it. A
 * reduction to EXACTLY `committed` is allowed — only `newTotal < committed`
 * fails.
 *
 * @param c - The projected total + resolved committed peak.
 * @returns `{ ok: true }` when the total still covers commitments; otherwise
 *   `{ ok: false, shortfall, message }`.
 */
export function checkQuantityNotBelowCommitted(
  c: CommittedCheck
): QuantityVerdict {
  if (c.newTotal >= c.committed) return { ok: true };

  const title = c.assetTitle ?? "This asset";
  const unit = c.unitOfMeasure || "units";
  return {
    ok: false,
    shortfall: c.committed - c.newTotal,
    message: `Cannot reduce "${title}" to ${c.newTotal} ${unit} — ${c.committed} ${unit} are committed (custody, kits, or overlapping bookings). Release or reduce those first.`,
  };
}

/* -------------------------------------------------------------------------- */
/*                           describeOverCommitment                           */
/* -------------------------------------------------------------------------- */

/**
 * Honest cause/cure copy for an over-committed asset (harvested from the
 * closed PR #2769's over-commitment callout). Given the resolved pool
 * components, it enumerates every non-zero DRIVER consuming the pool and the
 * concrete CURE for each, plus a one-line `text` summary. When the asset is
 * within capacity (`bookable >= 0`) it still returns a truthful "within
 * capacity" summary and no cures.
 *
 * @param inputs - The resolved pool components + optional asset title/unit.
 * @returns `{ drivers, cures, text }` — human-readable, side-effect-free copy.
 */
export function describeOverCommitment(
  inputs: AvailabilityInputs & {
    assetTitle?: string;
    unitOfMeasure?: string | null;
  }
): { drivers: string[]; cures: string[]; text: string } {
  const { total, inCustody, inKits, reservedPeak, checkedOut } = inputs;
  const unit = inputs.unitOfMeasure || "units";
  const title = inputs.assetTitle || "This asset";
  const { bookable } = computeAvailability(inputs);
  const shortfall = Math.max(0, -bookable);

  // Drivers are always informational — every non-zero pool consumer.
  const drivers: string[] = [];
  if (inCustody > 0) drivers.push(`${inCustody} ${unit} held in custody`);
  if (inKits > 0) drivers.push(`${inKits} ${unit} allocated to kits`);
  if (reservedPeak > 0) {
    drivers.push(`${reservedPeak} ${unit} reserved by overlapping bookings`);
  }
  if (checkedOut > 0)
    drivers.push(`${checkedOut} ${unit} currently checked out`);

  // Cures only make sense when the asset is actually over-committed —
  // within capacity there is nothing to fix.
  const cures: string[] = [];
  if (shortfall > 0) {
    if (inCustody > 0) cures.push("Release units held in custody");
    if (inKits > 0) cures.push("Remove units from kits");
    if (reservedPeak > 0)
      cures.push("Reduce or reschedule overlapping bookings");
    if (checkedOut > 0) cures.push("Check in outstanding units");
    cures.push(`Increase total stock by at least ${shortfall} ${unit}`);
  }

  const text =
    shortfall > 0
      ? `"${title}" is over-committed by ${shortfall} ${unit} (${total} total, ${bookable} bookable).` +
        (drivers.length > 0 ? ` Committed: ${drivers.join(", ")}.` : "") +
        (cures.length > 0 ? ` To fix: ${cures.join("; ")}.` : "")
      : `"${title}" is within capacity (${bookable} of ${total} ${unit} bookable).`;

  return { drivers, cures, text };
}
