/**
 * How audit assignees travel from the picker to the server.
 *
 * `AuditTeamMemberSelector` submits one bracket-indexed hidden input per
 * selected member (`assignees[0]`, `assignees[1]`, …), each a JSON blob
 * `{ id, name, userId }`; only `userId` matters server-side. The singular
 * `assignee` field is what forms rendered before multi-assign shipped submit,
 * and it stays accepted so a page left open across the deploy still saves.
 *
 * Client-safe: no server imports, so the zod schemas can use it on both sides.
 */

/** Form field name the selector emits (bracket-indexed). */
export const AUDIT_ASSIGNEES_FIELD = "assignees";

/**
 * Extracts the user id from one submitted assignee value.
 *
 * Accepts the picker's JSON blob or a bare user id (the pre-multi-assign
 * fallback). Returns undefined for anything without a usable user id, so a
 * hidden input rendered before the member list loaded cannot smuggle an empty
 * id into the assignment table.
 */
export function parseAssigneeUserId(
  value: string | null | undefined
): string | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      parsed &&
      typeof parsed === "object" &&
      "userId" in parsed &&
      typeof parsed.userId === "string" &&
      parsed.userId.length > 0
    ) {
      return parsed.userId;
    }
    return undefined;
  } catch {
    return value;
  }
}

/**
 * Resolves the submitted assignee fields to a deduplicated list of user ids.
 *
 * @param assignees - The bracket-indexed `assignees[i]` values, if any.
 * @param assignee - The legacy singular `assignee` value, if any.
 */
export function resolveAssigneeUserIds(
  assignees: string[] | undefined,
  assignee?: string | null
): string[] {
  const ids = [...(assignees ?? []), assignee]
    .map(parseAssigneeUserId)
    .filter((id): id is string => !!id);
  return Array.from(new Set(ids));
}
