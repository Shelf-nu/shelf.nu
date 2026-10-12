/**
 * Which scanner action a horizontal swipe lands on.
 *
 * The scanner's actions are filtered by the operator's role, so the list can
 * hold anything from zero entries to all four, and the wrap-around arithmetic
 * has to answer for every length. Separated from the gesture handler because
 * the handler lives inside a PanResponder that no test can drive, while this
 * is the part that decides anything.
 *
 * @see {@link file://../hooks/use-scanner-gestures.ts} the only caller
 */

/** Which way the operator swiped, as a step through the action list. */
export type SwipeDirection = "next" | "previous";

/**
 * The index a swipe moves to, wrapping around at both ends.
 *
 * @param actionCount - How many actions the operator's role allows
 * @param currentIndex - The action showing now
 * @param direction - Which way they swiped
 * @returns The index to switch to, or `null` when there is nowhere to go
 */
export function nextScannerActionIndex({
  actionCount,
  currentIndex,
  direction,
}: {
  actionCount: number;
  currentIndex: number;
  direction: SwipeDirection;
}): number | null {
  // One action is a switcher with nothing to switch to, and none at all means
  // the roles have not arrived yet. Both have to be refused before the modulo:
  // `% 0` is NaN, and comparing NaN to the current index never stops anything.
  if (actionCount < 2) {
    return null;
  }

  const from = Number.isInteger(currentIndex)
    ? ((currentIndex % actionCount) + actionCount) % actionCount
    : 0;

  const next =
    direction === "next"
      ? (from + 1) % actionCount
      : (from - 1 + actionCount) % actionCount;

  return next === from ? null : next;
}
