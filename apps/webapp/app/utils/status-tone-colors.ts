/**
 * Maps a shared {@link StatusTone} onto this app's badge palette.
 *
 * The tone itself lives in `@shelf/labels` alongside the words, so the webapp
 * and the companion app cannot disagree about which status deserves which
 * weight. Only the concrete colours are app-owned: the webapp has one fixed
 * palette, the companion resolves each tone twice for light and dark mode.
 *
 * Keep this visually equivalent to the companion's `buildToneBadge`
 * (`apps/companion/lib/theme-colors.ts`) — if one side changes what "danger"
 * looks like, the two apps drift again, which is the bug this indirection
 * exists to prevent.
 *
 * @see {@link file://./badge-colors.ts}
 */
import type { StatusTone } from "@shelf/labels";

import { BADGE_COLORS, type BadgeColorScheme } from "./badge-colors";

const TONE_COLORS: Record<StatusTone, BadgeColorScheme> = {
  neutral: BADGE_COLORS.gray,
  info: BADGE_COLORS.blue,
  success: BADGE_COLORS.green,
  warning: BADGE_COLORS.amber,
  danger: BADGE_COLORS.red,
};

/**
 * @param tone - the shared semantic weight for a status
 * @returns the badge background/text pair for that tone
 */
export function toneBadgeColors(tone: StatusTone): BadgeColorScheme {
  return TONE_COLORS[tone];
}
