/**
 * Where the scanner's closed "Enter code" pill sits.
 *
 * The pill lives low in the bottom strip, under the camera controls (pause,
 * flashlight), in the thumb zone. How much room that strip leaves below the
 * controls depends on the screen's height: plenty on a phone, little on a
 * short window such as an iPhone Duo opened sideways (669 pt tall) or a
 * small phone. The pill never overlaps the controls: it drops lower when the
 * strip is short, and moves to the top strip when even that does not fit.
 *
 * Pure (no React Native import) so the maths runs under `node --test`.
 *
 * @see app/(tabs)/scanner.tsx for the pill and the measurements
 */

/** The pill's distance from the bottom edge when the strip has room for it. */
export const MANUAL_ENTRY_BOTTOM = 90;

/**
 * Height of the closed pill at the default text size, in points (one line of
 * small text plus padding), for use until the pill has been measured.
 */
const DEFAULT_PILL_HEIGHT = 24;

/** Air kept between the camera controls and the pill. */
const GAP_BELOW_CONTROLS = 8;

/** Air kept between the pill and the bottom inset (home indicator). */
const GAP_ABOVE_EDGE = 8;

/**
 * Bottom offset for the closed pill, or `null` when it belongs in the top
 * strip because the bottom strip has no room under the controls.
 *
 * @param spaceBelowControls - points between the camera controls' bottom edge
 *   and the screen's bottom edge, or `null` before they have been measured
 * @param bottomInset - the screen's bottom inset (home indicator), when
 *   nothing below the screen covers it
 * @param pillHeight - the pill's measured height, which grows with the
 *   system text size
 */
export function closedManualEntryBottom(
  spaceBelowControls: number | null,
  bottomInset: number,
  pillHeight: number = DEFAULT_PILL_HEIGHT
): number | null {
  if (spaceBelowControls === null) return MANUAL_ENTRY_BOTTOM;
  const highest = spaceBelowControls - GAP_BELOW_CONTROLS - pillHeight;
  const bottom = Math.min(MANUAL_ENTRY_BOTTOM, highest);
  return bottom >= bottomInset + GAP_ABOVE_EDGE ? bottom : null;
}
