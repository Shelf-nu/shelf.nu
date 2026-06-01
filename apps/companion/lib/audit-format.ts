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
import { formatDate } from "@/lib/constants";

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
 * @returns the badge label (or null) and its urgency tier
 */
export function formatDue(
  dueDate: string | null,
  isActive: boolean
): { label: string | null; tier: DueTier } {
  if (!isActive) return { label: null, tier: "none" };
  if (!dueDate) return { label: "No due date", tier: "none" };
  const dayMs = 24 * 60 * 60 * 1000;
  const ms = new Date(dueDate).getTime() - Date.now();
  if (ms < 0) {
    const d = Math.max(1, Math.ceil(-ms / dayMs));
    return { label: `Overdue ${d}d`, tier: "overdue" };
  }
  const days = Math.round(ms / dayMs);
  if (days === 0) return { label: "Due today", tier: "soon" };
  if (days === 1) return { label: "Due tomorrow", tier: "soon" };
  if (days <= 3) return { label: `Due in ${days}d`, tier: "soon" };
  return { label: `Due ${formatDate(dueDate)}`, tier: "neutral" };
}
