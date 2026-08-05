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

import type { QtConsumptionCategory, QtConsumptionType } from "./types.js";

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
 * The two terminal categories a custody release can resolve to. Narrowed from
 * {@link QtConsumptionCategory} so the literals can never drift from the
 * database enum — the enum-parity test in `./enums.test.ts` guards that union
 * against `schema.prisma`.
 */
export type ReleaseCategory = Extract<
  QtConsumptionCategory,
  "RETURN" | "CONSUME"
>;

/**
 * What ending a hold on a QUANTITY_TRACKED asset's units MEANS for a given
 * consumption type.
 *
 * `ONE_WAY` assets (gloves, batteries, cable ties) are used up in the field:
 * the units never come back, so the pool must shrink. `TWO_WAY` assets are
 * returnable and their units go back into the available pool. A `null` /
 * `undefined` type is a legacy row that predates the column and is treated as
 * returnable — the pre-existing behaviour, because silently consuming that
 * stock would destroy data.
 *
 * This is the ONE place the rule is encoded. The webapp service, the webapp
 * custody list and the companion asset screen all import it: a `.server`
 * module cannot be reached by a client component, and neither can be reached
 * by React Native, so the shared package is the only common ground.
 *
 * @param consumptionType - The asset's `consumptionType` (nullable on legacy rows).
 * @returns `"CONSUME"` for a one-way consumable, `"RETURN"` otherwise.
 */
export function releaseCategory(
  consumptionType: QtConsumptionType | null | undefined
): ReleaseCategory {
  return consumptionType === "ONE_WAY" ? "CONSUME" : "RETURN";
}

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
  return releaseCategory(consumptionType) === "CONSUME"
    ? { consumed: cap }
    : { returned: cap };
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
