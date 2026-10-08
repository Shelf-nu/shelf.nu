/**
 * useRoleAccess: the signed-in member's access in the current workspace.
 * Recomputed only when the current organization changes.
 *
 * @see {@link file://../lib/role-access.ts}
 */
import { useMemo } from "react";
import type { RoleAccess } from "@shelf/permissions";

import { useOrg } from "@/lib/org-context";
import { accessForOrganization } from "@/lib/role-access";

/**
 * Returns the member's access in the current workspace.
 *
 * @returns The member's `RoleAccess`; BASE while the organization is loading
 */
export function useRoleAccess(): RoleAccess {
  const { currentOrg } = useOrg();
  return useMemo(() => accessForOrganization(currentOrg), [currentOrg]);
}
