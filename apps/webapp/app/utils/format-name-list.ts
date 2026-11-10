/**
 * Short name lists for inline UI copy.
 *
 * Notices that name the things an action affects ("Camera A, Mic, Tripod and
 * 2 more") share this so their lists read the same.
 *
 * @see {@link file://./../components/kits/booking-removal-notice.tsx}
 * @see {@link file://./../components/kits/cross-kit-move-notice.tsx}
 */

/** How many names a list spells out before it is elided. */
const MAX_NAMED_ITEMS = 3;

/**
 * Renders a list of names as "A, B, C and 2 more".
 *
 * Names up to three, then elides. It spells the remainder out ("and 2 more")
 * rather than a trailing ", …", which would collide with the sentence's full
 * stop.
 *
 * @param names - The names to list, in display order
 * @returns The rendered list, or an empty string for no names
 */
export function formatNameList(names: string[]): string {
  const shown = names.slice(0, MAX_NAMED_ITEMS).join(", ");
  const hiddenCount = names.length - MAX_NAMED_ITEMS;
  return hiddenCount > 0 ? `${shown} and ${hiddenCount} more` : shown;
}
