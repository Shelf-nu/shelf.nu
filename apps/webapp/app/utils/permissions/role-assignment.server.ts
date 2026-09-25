/**
 * Role assignment guard
 *
 * The one actor-aware check every role writer calls before it writes: single
 * invite, CSV import and invite resend. A role whose policy says
 * `membership.changeRequiresOwner` can only be granted by the workspace owner.
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
import { ROLE_LABELS } from "./role-access";

/**
 * Refuses an assignment the actor may not make.
 *
 * @param args.actorOwnsWorkspace - `access.ownsWorkspace` of the acting member
 * @param args.roles - Every role the write would assign
 * @param args.organizationId - For error context
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
  const refused = [...new Set(roles)].filter(
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
