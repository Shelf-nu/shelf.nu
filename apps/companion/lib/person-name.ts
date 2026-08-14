/**
 * Builds a display name from the optional first/last name pair the API returns.
 *
 * Every surface that shows a person (booking creator, custodian, note author,
 * audit assignee) had its own copy of
 * `[firstName, lastName].filter(Boolean).join(" ") || null`, so a user with only
 * a first name rendered as "Carlos" in one place and " Carlos" in another.
 * Returns null rather than an empty string so callers can fall back with `??`.
 */
export function formatPersonName(
  firstName?: string | null,
  lastName?: string | null
): string | null {
  return [firstName, lastName].filter(Boolean).join(" ").trim() || null;
}
