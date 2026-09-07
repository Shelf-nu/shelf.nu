/**
 * Resolves the caller's OWN team-member record in a workspace.
 *
 * The mobile team-members endpoint returns only the caller's own record for
 * SELF_SERVICE roles, so the first row is the caller. Self-service custody
 * flows resolve through here and skip the member picker entirely — those
 * users can only take custody themselves, so a roster with one row (their
 * own) is not a choice worth presenting.
 *
 * @param orgId - the workspace to resolve the record in
 * @returns the member, or a user-presentable error when it cannot be found
 */
import { api, type TeamMember } from "./api";

export async function resolveSelfTeamMember(
  orgId: string
): Promise<{ member: TeamMember | null; error: string | null }> {
  const { data, error } = await api.teamMembers(orgId);
  const member = data?.teamMembers?.[0] ?? null;
  if (error || !member) {
    return {
      member: null,
      error:
        error || "Could not find your team member record for this workspace.",
    };
  }
  return { member, error: null };
}
