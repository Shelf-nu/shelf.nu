/**
 * Role assignment guard
 *
 * The one actor-aware check every invite path calls before it writes: single
 * invite, CSV import and invite resend. It refuses two things, in order:
 *
 * 1. A role no invite may grant (`membership.invitable` is false, so OWNER).
 *    Ownership moves only through `transferOwnership`. Callers validate their
 *    input first, but the guard refuses these itself so a caller that forgets
 *    cannot write an OWNER invite.
 * 2. A role whose policy says `membership.changeRequiresOwner`, when the actor
 *    is not the workspace owner.
 *
 * The check runs before any read or write, so a refused request leaves no
 * trace.
 *
 * @see {@link file://./membership-access.ts} canAssignRole
 * @see {@link file://./../../modules/invite/service.server.ts}
 * @see {@link file://./../../modules/user/utils.server.ts}
 */
import { ShelfError } from "~/utils/error";
import { canAssignRole } from "./membership-access";
import type { OrganizationRole } from "./role-access";
import { INVITABLE_ROLES, ROLE_LABELS } from "./role-access";

/**
 * Refuses an assignment the actor may not make.
 *
 * @param args.actorOwnsWorkspace - `access.ownsWorkspace` of the acting member
 * @param args.roles - Every role the write would assign
 * @param args.organizationId - For error context
 * @throws {ShelfError} 400 when a role can never be granted by invite
 * @throws {ShelfError} 403 naming the roles only the owner may grant
 */
export function assertCanAssignRoles({
  actorOwnsWorkspace,
  roles,
  organizationId,
}: {
  actorOwnsWorkspace: boolean;
  roles: readonly OrganizationRole[];
  organizationId: string;
}): void {
  const uniqueRoles = [...new Set(roles)];

  const notInvitable = uniqueRoles.filter(
    (role) => !INVITABLE_ROLES.includes(role)
  );
  if (notInvitable.length > 0) {
    throw new ShelfError({
      cause: null,
      title: "Invalid role",
      message: `Invites cannot grant the ${notInvitable
        .map((role) => ROLE_LABELS[role])
        .join(", ")} role. Ownership moves only through ownership transfer.`,
      additionalData: { organizationId, notInvitable },
      label: "Team",
      status: 400,
      shouldBeCaptured: false,
    });
  }

  const refused = uniqueRoles.filter(
    (role) => !canAssignRole({ actorOwnsWorkspace, role })
  );
  if (refused.length === 0) return;

  throw new ShelfError({
    cause: null,
    title: "Insufficient permissions",
    message: `Only the workspace owner can grant the ${refused
      .map((role) => ROLE_LABELS[role])
      .join(", ")} role.`,
    additionalData: { organizationId, refused },
    label: "Team",
    status: 403,
    shouldBeCaptured: false,
  });
}
