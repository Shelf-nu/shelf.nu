/**
 * Import mapping: the per-workspace daily guard on model calls.
 *
 * Counts model calls per organization per UTC day and refuses more than
 * {@link DAILY_MODEL_CALLS_PER_ORGANIZATION}; past the limit the importer uses
 * the rule-based proposal, which looks the same to the user.
 *
 * The counter lives in this process's memory. It resets when the process
 * restarts and each server machine keeps its own count, so the effective
 * ceiling is the limit times the number of machines. A database-backed counter
 * is the follow-up before wide rollout.
 *
 * @see {@link file://./model.server.ts} the caller
 */

/** Most model calls one organization may make per UTC day, per process. */
export const DAILY_MODEL_CALLS_PER_ORGANIZATION = 50;

/** organizationId -> calls made on `day` (YYYY-MM-DD, UTC). */
const usage = new Map<string, { day: string; count: number }>();

/** Today's date in UTC as YYYY-MM-DD. */
function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Records one model call for an organization if it is still under the limit.
 *
 * @param organizationId - The workspace asking for a mapping
 * @param now - Current time; injectable for tests
 * @returns `true` when the call may go ahead (and is now counted)
 */
export function tryConsumeModelCall(
  organizationId: string,
  now: Date = new Date()
): boolean {
  const day = utcDay(now);
  const entry = usage.get(organizationId);
  const count = entry?.day === day ? entry.count : 0;
  if (count >= DAILY_MODEL_CALLS_PER_ORGANIZATION) return false;
  usage.set(organizationId, { day, count: count + 1 });
  return true;
}

/** Clears every counter. Tests only. */
export function resetModelCallUsage(): void {
  usage.clear();
}
