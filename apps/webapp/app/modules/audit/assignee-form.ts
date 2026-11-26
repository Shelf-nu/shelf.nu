/**
 * How audit assignees travel from the picker to the server.
 *
 * `AuditTeamMemberSelector` submits one bracket-indexed hidden input per
 * selected member (`assignees[0]`, `assignees[1]`, …), each a JSON blob
 * `{ id, name, userId }`; only `userId` matters server-side. The singular
 * `assignee` field is still accepted from older clients and merged into the
 * list by `resolveAssigneeUserIds`.
 *
 * Client-safe: no server imports, so the zod schemas can use it on both sides.
 */

/** Form field name the selector emits (bracket-indexed). */
export const AUDIT_ASSIGNEES_FIELD = "assignees";

/**
 * Extracts the user id from one submitted assignee value.
 *
 * Accepts the picker's JSON blob or a bare user id (what the singular
 * `assignee` field may carry). Returns undefined for anything without a usable user id, so a
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
 * @param assignee - The singular `assignee` value, if any.
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

/** One selectable team member, as the audit loaders list them. */
type AssignableTeamMember = { id: string; name: string; userId: string | null };

/**
 * Maps an audit's current assignments to the picker's pre-selected members.
 *
 * The picker toggles on team member ids while the server stores user ids, so
 * each assignment is matched to the team member with the same user id. An
 * assignee with no team member in the list cannot be shown or re-submitted,
 * so they are left out; the edit form submits the full set, which means saving
 * then removes that assignment.
 *
 * @param assignments - The audit's current assignments (only `userId` is read).
 * @param teamMembers - The team members the picker can show.
 * @returns One `{ id, userId, name }` per assignee who has a team member.
 */
export function toAssigneeDefaults(
  assignments: ReadonlyArray<{ userId: string }>,
  teamMembers: ReadonlyArray<AssignableTeamMember>
): Array<{ id: string; userId: string; name: string }> {
  return assignments.flatMap((assignment) => {
    const teamMember = teamMembers.find(
      (tm) => tm.userId === assignment.userId
    );
    return teamMember
      ? [
          {
            id: teamMember.id,
            userId: assignment.userId,
            name: teamMember.name,
          },
        ]
      : [];
  });
}
