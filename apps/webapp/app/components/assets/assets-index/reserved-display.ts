/**
 * `Reserved` cell display logic.
 *
 * Pure, and separate from the cell, because the rule it encodes is one a
 * reasonable person gets wrong, it was got wrong once already, in a way no
 * compiler or existing test could see.
 *
 * **`reserved` is a SUM across every upcoming booking. It must never be
 * compared against the pool size.** `Asset.quantity` is a stock level; a sum
 * over a year of bookings is not a stock level, and the two are not comparable.
 * A cable booked every week for a year totals 500 reserved against a pool of
 * 10, and nothing at all is wrong with that asset. The first version of this
 * cell compared them and would have painted "490 short" on a perfectly healthy
 * row, precisely on the busiest workspaces, where a false alarm is most
 * expensive and hardest to dismiss.
 *
 * Over-commitment is a fact about a MOMENT, not a total: the most units owed
 * to bookings at any single instant ahead (`peakBooked`, the booking engine's
 * own peak-concurrency sweep) against what the pool holds once custody and
 * kits are taken out. That is what `classifyStockStatus` judges, so this cell
 * defers to the verdict rather than recomputing anything: the cell and the
 * `Stock status` pill then cannot disagree, by construction.
 *
 * @see {@link file://../../../../../packages/quantity-control/src/stock-status.ts}
 * @see {@link file://./advanced-asset-columns.tsx} - the cell that renders this.
 */

import { shortfallUnits, type StockStatus } from "@shelf/quantity-control";

/** The figures a row carries for its reserved cell. */
export type ReservedDisplayInput = {
  /** Sum of units promised across every upcoming booking. */
  reserved: number;
  /** `Asset.quantity`, or null for an individually-tracked asset. */
  quantity: number | null;
  /** The verdict from the shared classifier. Null for INDIVIDUAL assets. */
  stockStatus: StockStatus | null;
  /** The most units owed to bookings at one instant ahead, what the verdict was computed from. */
  peakBooked: number;
  /** Units held in direct custody (kit-inherited custody sits inside `inKits`). */
  inCustody: number;
  inKits: number;
  /** Free-text unit label, when the asset has one. */
  unitOfMeasure?: string | null;
};

/** What the cell should render. */
export type ReservedDisplay = {
  /** Visible text. */
  text: string;
  /** Whether to draw attention, same violet as the `Short` badge. */
  isOversold: boolean;
  /** Full sentence for a screen reader, or null when there is nothing to flag. */
  title: string | null;
};

/**
 * Decides what the `Reserved` cell shows.
 *
 * @param input - See {@link ReservedDisplayInput}.
 * @returns The text, whether to flag it, and the accessible description.
 */
export function resolveReservedDisplay(
  input: ReservedDisplayInput
): ReservedDisplay {
  const {
    reserved,
    quantity,
    stockStatus,
    peakBooked,
    inCustody,
    inKits,
    unitOfMeasure,
  } = input;

  /**
   * An INDIVIDUAL asset is a pool of one with no unit of measure. It renders a
   * bare count and can never oversell, so it never reaches the flag.
   */
  const isPool = quantity != null;
  const unit = isPool && unitOfMeasure ? ` ${unitOfMeasure}` : "";
  const owned = quantity ?? 0;

  const shortfall = shortfallUnits({
    total: owned,
    inCustody,
    inKits,
    peakBooked,
  });

  /**
   * `peakBooked > 0` keeps the flag off a row whose shortfall comes entirely
   * from custody or kits. The verdict would still be SHORT there, and
   * correctly so, but the reserved column is not the culprit and should not
   * claim to be.
   */
  const isOversold =
    isPool && stockStatus === "SHORT" && peakBooked > 0 && shortfall > 0;

  if (!isOversold) {
    return { text: `${reserved}${unit}`, isOversold: false, title: null };
  }

  /** The other claims, named only when they exist, so the sentence adds up. */
  const held = [
    inCustody > 0 ? `${inCustody} in custody` : null,
    inKits > 0 ? `${inKits} in kits` : null,
  ].filter((part): part is string => part != null);
  const heldClause = held.length > 0 ? ` plus ${held.join(" and ")}` : "";

  return {
    text: `${reserved}${unit} · ${shortfall} short`,
    isOversold: true,
    title: `At the busiest point ahead, bookings need ${peakBooked}${unit} at once${heldClause}, against ${owned}${unit} owned, short by ${shortfall}. ${reserved} promised across all upcoming bookings.`,
  };
}
