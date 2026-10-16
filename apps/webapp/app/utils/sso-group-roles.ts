/**
 * SSO group columns: which organization role each `SsoDetails` group-id
 * column confers when a user's IdP groups match it.
 *
 * Keyed by column, valued by role: this states what a mapping ASSIGNS, not an
 * access decision. Which of several matched roles wins is the policy table's
 * rank (`resolveRole`); which roles may be conferred at all is
 * `SSO_ASSIGNABLE_ROLES`. A test pins that the values here are exactly
 * `SSO_ASSIGNABLE_ROLES`, so adding an assignable role without its column (or a
 * column without an assignable role) fails.
 *
 * Pure (no server imports), so client code can read the same columns.
 *
 * @see {@link file://./roles.server.ts} getRoleFromGroupId
 */
import type { SsoDetails } from "@prisma/client";
import type { OrganizationRole } from "./permissions/role-access";

/** A group-id column on `SsoDetails`. */
export type SsoGroupField =
  | "adminGroupId"
  | "managerGroupId"
  | "selfServiceGroupId"
  | "baseUserGroupId";

/** The role each group-id column confers. */
export const SSO_GROUP_ROLE = {
  adminGroupId: "ADMIN",
  managerGroupId: "MANAGER",
  selfServiceGroupId: "SELF_SERVICE",
  baseUserGroupId: "BASE",
} as const satisfies Record<SsoGroupField, OrganizationRole>;

/** Compile error if a group-id column is renamed or removed on `SsoDetails`. */
type AssertColumnsExist = SsoGroupField extends keyof SsoDetails ? true : never;
const _columnsExist: AssertColumnsExist = true;
void _columnsExist;

/**
 * Whether a workspace maps any IdP group to a role, that is, whether SSO
 * manages its members' access.
 *
 * @param ssoDetails - The workspace's SSO group columns
 * @returns `true` when at least one group-id column is set
 */
export function hasSsoGroupMappings(
  ssoDetails: Pick<SsoDetails, SsoGroupField>
): boolean {
  return (Object.keys(SSO_GROUP_ROLE) as SsoGroupField[]).some(
    (field) => !!ssoDetails[field]
  );
}
