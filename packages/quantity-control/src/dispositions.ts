/**
 * `@shelf/quantity-control` — check-in disposition helpers.
 *
 * The pure arithmetic behind a QUANTITY_TRACKED asset's check-in disposition,
 * extracted from the booking check-in flow (`booking/service.server.ts`).
 * A disposition splits the units being checked in across four terminal
 * categories; these helpers decide the default split, sum the claimed units,
 * compute how many leave the pool for good, and detect an over-claim — with no
 * Prisma, transaction, or `ShelfError` coupling.
 *
 * @see {@link file://./types.ts}
 */

import type { QtConsumptionType } from "./types.js";

/**
 * A per-row check-in disposition: how many of the checked-in units were
 * returned to stock vs. permanently removed (consumed / lost / damaged). Every
 * field is optional and defaults to 0.
 */
export type Disposition = {
  /** Units returned to the available pool (TWO_WAY). */
  returned?: number;
  /** Units used as intended and gone (ONE_WAY consumable). */
  consumed?: number;
  /** Units reported lost. */
  lost?: number;
  /** Units returned but unusable. */
  damaged?: number;
};

/**
 * The auto-default disposition for a given consumption type, claiming exactly
 * `cap` units (the remaining amount on the booking slice):
 *   - `ONE_WAY`  → consume all remaining (nothing comes back).
 *   - `TWO_WAY`  → return all remaining.
 *
 * @param consumptionType - The asset's consumption type.
 * @param cap - Units remaining to disposition (the claim amount).
 * @returns The default {@link Disposition}.
 */
export function defaultDisposition(
  consumptionType: QtConsumptionType,
  cap: number
): Disposition {
  return consumptionType === "ONE_WAY" ? { consumed: cap } : { returned: cap };
}

/**
 * Total units claimed by a disposition — the amount that reduces `remaining`
 * for the (booking, asset) pair. Pending units are never submitted; they
 * emerge from the gap between `remaining` and this sum.
 *
 * @param d - The disposition.
 * @returns `returned + consumed + lost + damaged`.
 */
export function sumDisposition(d: Disposition): number {
  return (
    (d.returned ?? 0) + (d.consumed ?? 0) + (d.lost ?? 0) + (d.damaged ?? 0)
  );
}

/**
 * Units that leave the pool for good — everything except returns. This is the
 * amount subtracted from `Asset.quantity` on check-in (returns go back to the
 * available pool instead).
 *
 * @param d - The disposition.
 * @returns `consumed + lost + damaged`.
 */
export function poolDecrement(d: Disposition): number {
  return (d.consumed ?? 0) + (d.lost ?? 0) + (d.damaged ?? 0);
}

/**
 * Whether a disposition claims MORE units than are available (`cap`). An
 * explicit disposition that over-claims is a hard error in the app; the
 * auto-default is pre-clamped to `cap` and never trips this.
 *
 * @param d - The disposition.
 * @param cap - Units remaining to disposition.
 * @returns `true` when `sumDisposition(d) > cap`.
 */
export function capExceeded(d: Disposition, cap: number): boolean {
  return sumDisposition(d) > cap;
}
