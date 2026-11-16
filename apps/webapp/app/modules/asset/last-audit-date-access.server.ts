/**
 * Server-side resolution of the last audit date access level.
 *
 * Binds the pure rule in {@link file://./last-audit-date-access.ts} to the
 * caller's role access and the workspace's audit add-on, so every server entry
 * point (index loader, drill-down sheet, bulk selection) decides identically.
 */
import type { RoleAccess } from "~/utils/permissions/role-access";
import { canUseAudits } from "~/utils/subscription.server";
import { resolveLastAuditDateAccess } from "./last-audit-date-access";
import type { LastAuditDateAccess } from "./last-audit-date-access";

/**
 * Resolves how the last audit date may be used for this caller and workspace.
 *
 * @param access - The caller's resolved role access
 * @param organization - The workspace, carrying its audit add-on flag
 * @returns The access level: `available`, `locked` or `hidden`
 */
export function lastAuditDateAccessFor(
  access: RoleAccess,
  organization: { auditsEnabled: boolean }
): LastAuditDateAccess {
  return resolveLastAuditDateAccess({
    seeAllAudits: access.audits.seeAll,
    auditsUsable: canUseAudits(organization),
  });
}
