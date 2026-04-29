/**
 * Distribution helpers
 *
 * Pure, side-effect-free math used by the reporting-demo seeder to shape
 * synthetic data so it looks like real operational history:
 *
 * - `paretoIndex` — biases selection so "top 20%" of a population takes a
 *   disproportionate share of events (applied to asset booking popularity).
 * - `seasonalMultiplier` — monthly weight used to bend booking-creation
 *   volume across 12 months (1.4× Jun–Jul, 0.7× Jan–Feb, else 1.0).
 * - `zipfWeights` — Zipf-style weights where actor #1 is used ~2× more than
 *   actor #10; used to pick which TeamMember "performed" a random event.
 * - `weightedPick` / `randomIntInRange` / `randomDateBetween` — small helpers
 *   the generators compose.
 *
 * All randomness is driven by an injected `rng: () => number` that yields
 * values in `[0, 1)` — callers pass a seeded faker instance so runs are
 * deterministic.
 */

/** Minimal RNG shape — `Math.random()` and faker both satisfy it. */
export type RNG = () => number;

/**
 * Sample an index from `[0, size)` with a head-heavy (Pareto-style) bias:
 * low indices (the "head") are sampled much more often than high indices
 * (the "tail").
 *
 * Uses the inverse-CDF form `floor(size * (1 - U^(1/alpha)))` — `alpha > 1`
 * concentrates mass at the head. The closed-form probability that the
 * result is in the top `p` fraction is `1 - (1 - p)^alpha`.
 *
 * Default `alpha = 4` gives "top 20% of the population takes ~59% of
 * events" (1 - 0.8⁴ ≈ 0.59), a visible Pareto skew that matches the
 * seeder's goal of making "Top Booked Assets" reports show a clear lead.
 *
 * @param size - Upper bound (exclusive). `size > 0` required.
 * @param rng - Uniform `[0, 1)` source.
 * @param alpha - Skew parameter, >= 1. Higher = more head-heavy. Default 4.
 * @returns Integer in `[0, size)`.
 */
export function paretoIndex(size: number, rng: RNG, alpha = 4): number {
  if (size <= 0) throw new Error("paretoIndex: size must be > 0");
  const u = 1 - rng();
  const idx = Math.floor(size * (1 - Math.pow(u, 1 / alpha)));
  return Math.min(size - 1, Math.max(0, idx));
}

/**
 * Monthly multiplier for booking volume — captures a light seasonality so
 * reports like "Monthly Booking Trends" show a visible curve rather than a
 * flat line. The overall average across 12 months is ~1.0.
 *
 * @param month - `Date.getMonth()` output (0 = Jan, 11 = Dec).
 * @returns Multiplier to apply to the base rate for that month.
 */
export function seasonalMultiplier(month: number): number {
  // Peak in early summer, trough in deep winter.
  switch (month) {
    case 5: // Jun
    case 6: // Jul
      return 1.4;
    case 4: // May
    case 7: // Aug
      return 1.2;
    case 0: // Jan
    case 1: // Feb
      return 0.7;
    case 10: // Nov
    case 11: // Dec
      return 0.85;
    default:
      return 1.0;
  }
}

/**
 * Zipf-style weights for an ordered pool. Weight #k ∝ 1/(k+1), so the first
 * member receives ~2× the activity of the 10th, ~5× of the 50th.
 *
 * @param count - Number of actors in the pool.
 * @returns Normalized weights that sum to 1.
 */
export function zipfWeights(count: number): number[] {
  if (count <= 0) return [];
  const raw = Array.from({ length: count }, (_, i) => 1 / (i + 1));
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((w) => w / sum);
}

/**
 * Pick an index weighted by a normalised distribution. Callers precompute
 * weights once (e.g. `zipfWeights`) and reuse across many picks.
 *
 * @param weights - Non-negative weights summing to ~1.
 * @param rng - Uniform `[0, 1)` source.
 * @returns Index in `[0, weights.length)`.
 */
export function weightedPick(weights: readonly number[], rng: RNG): number {
  const r = rng();
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (r < acc) return i;
  }
  return weights.length - 1;
}

/**
 * Uniform integer in `[min, max]` (both inclusive).
 *
 * @param min - Lower bound (inclusive).
 * @param max - Upper bound (inclusive). Must be >= min.
 * @param rng - Uniform `[0, 1)` source.
 */
export function randomIntInRange(min: number, max: number, rng: RNG): number {
  if (max < min) throw new Error("randomIntInRange: max < min");
  return Math.floor(rng() * (max - min + 1)) + min;
}

/**
 * Uniform `Date` in `[start, end)`.
 *
 * @param start - Inclusive lower bound.
 * @param end - Exclusive upper bound. Must be > start.
 * @param rng - Uniform `[0, 1)` source.
 */
export function randomDateBetween(start: Date, end: Date, rng: RNG): Date {
  const a = start.getTime();
  const b = end.getTime();
  if (b <= a) throw new Error("randomDateBetween: end <= start");
  return new Date(a + rng() * (b - a));
}
