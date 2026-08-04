/**
 * Shared audit presentation helpers.
 *
 * Single source of truth for how audit fields are worded across every
 * surface that renders an audit (the Audits list, an audit's detail, and
 * the Home dashboard's "Active Audits" cards). Keeping this here prevents
 * the surfaces from drifting — e.g. the same audit reading "Due tomorrow"
 * in the list but "Due 2 Jun" on Home.
 *
 * @see {@link file://./../app/(tabs)/audits/index.tsx} (Audits list)
 * @see {@link file://./../app/(tabs)/home.tsx} (Home "Active Audits" cards)
 */
import {
  calendarDayIndex,
  formatDate,
  type ResolvedFormatPrefs,
} from "@shelf/datetime";

/**
 * Urgency tier for an audit's deadline.
 * - `overdue` (red): past its due date
 * - `soon` (amber): due within the next 3 days
 * - `neutral` (gray): due further out — shown as a calm absolute date
 * - `none` (gray): active audit with no deadline at all
 */
export type DueTier = "overdue" | "soon" | "neutral" | "none";

/**
 * Builds the human, relative deadline label + urgency tier shown on an
 * audit card. Returns a null label for completed/cancelled audits (the
 * card shows the status badge instead) so we never render a stale
 * "Overdue" on work that's already done. Wording mirrors the webapp's
 * due-date language so a user toggling between web and companion sees the
 * same signal.
 *
 * @param dueDate - ISO due date, or null when none is set
 * @param isActive - whether the audit is still PENDING/ACTIVE
 * @param prefs - the acting user's resolved format prefs, used for the absolute
 *   "Due <date>" label so it renders in their date format + timezone
 * @returns the badge label (or null) and its urgency tier
 */
export function formatDue(
  dueDate: string | null,
  isActive: boolean,
  prefs: ResolvedFormatPrefs
): { label: string | null; tier: DueTier } {
  if (!isActive) return { label: null, tier: "none" };
  if (!dueDate) return { label: "No due date", tier: "none" };
  const now = new Date();
  const due = new Date(dueDate);
  // why: compare CALENDAR DAYS in the user's PREFERRED timezone. Due dates are
  // date-times, so a rounded millisecond delta mislabels by a day near the
  // boundary (Codex, PR #2583); and a DEVICE-local day count disagrees with the
  // tz-formatted absolute date below when the device zone differs from the
  // preference (Codex/CodeRabbit, PR #2798). `calendarDayIndex` measures both
  // ends in `prefs.timeZone`, so the relative and absolute labels always agree.
  const calDays =
    calendarDayIndex(due, prefs.timeZone) -
    calendarDayIndex(now, prefs.timeZone);
  if (due.getTime() < now.getTime()) {
    // Past the due moment. Count whole calendar days late; if it's still the
    // same day (overdue by hours), just say "Overdue".
    const lateDays = -calDays;
    return {
      label: lateDays >= 1 ? `Overdue ${lateDays}d` : "Overdue",
      tier: "overdue",
    };
  }
  if (calDays === 0) return { label: "Due today", tier: "soon" };
  if (calDays === 1) return { label: "Due tomorrow", tier: "soon" };
  if (calDays <= 3) return { label: `Due in ${calDays}d`, tier: "soon" };
  return { label: `Due ${formatDate(dueDate, prefs)}`, tier: "neutral" };
}
