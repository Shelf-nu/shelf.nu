/**
 * Workspace Plans
 *
 * Lists, for every workspace a user belongs to, the plan that workspace runs
 * on and who pays for it. A workspace's plan is its OWNER's tier, the same
 * rule `getOrganizationTierLimit` uses to gate features, so an administrator
 * invited into a paid Team workspace sees that workspace as Team even though
 * their own account is Free.
 *
 * Only the plan name and the payer's display name leave this module. Prices,
 * invoices and payment details belong to the owner's own Stripe account and
 * are never read here: other members of a workspace are not entitled to them.
 *
 * @see {@link file://./../../utils/workspace-plans.ts}
 * @see {@link file://./../tier/service.server.ts}
 * @see {@link file://./../../routes/_layout+/account-details.subscription.tsx}
 */

import type { Prisma } from "@prisma/client";
import { db } from "~/database/db.server";
import { USER_NAME_SELECT } from "~/modules/user/fields";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError } from "~/utils/error";
import { organizationRolesMap } from "~/utils/organization-roles";
import { resolveMostPrivilegedRole } from "~/utils/role-precedence";
import { resolveUserDisplayName } from "~/utils/user";
import type { WorkspacePlanRow } from "~/utils/workspace-plans";
import {
  resolveWorkspacePlan,
  sortWorkspacePlanRows,
} from "~/utils/workspace-plans";

const label: ErrorLabel = "Subscription";

/**
 * Fields read for each membership. The owner's tier decides the plan; the
 * owner's name fields decide how the payer is shown.
 */
const WORKSPACE_PLAN_MEMBERSHIP_SELECT = {
  roles: true,
  user: { select: { sso: true } },
  organization: {
    select: {
      id: true,
      name: true,
      type: true,
      imageId: true,
      userId: true,
      owner: {
        select: {
          id: true,
          ...USER_NAME_SELECT,
          tierId: true,
          customTierLimit: { select: { isEnterprise: true } },
        },
      },
    },
  },
} satisfies Prisma.UserOrganizationSelect;

/**
 * Builds the workspaces' plans table for a user: one row per workspace they
 * belong to, with the plan (from the workspace owner's tier), the user's role
 * and who pays.
 *
 * @param args.userId - The signed-in user whose memberships are listed
 * @param args.currentOrganizationId - The workspace the user has selected,
 *   flagged as current and listed first
 * @returns Rows ordered by {@link sortWorkspacePlanRows}
 * @throws {ShelfError} If the memberships cannot be loaded
 */
export async function getWorkspacePlansForUser({
  userId,
  currentOrganizationId,
}: {
  userId: string;
  currentOrganizationId: string;
}): Promise<WorkspacePlanRow[]> {
  try {
    const memberships = await db.userOrganization.findMany({
      where: { userId },
      select: WORKSPACE_PLAN_MEMBERSHIP_SELECT,
    });

    // SSO users never see their personal workspace anywhere in the app (the
    // workspace switcher hides it too), so it must not appear here either.
    const visibleMemberships = memberships.filter(
      ({ user, organization }) =>
        !(user.sso && organization.type === "PERSONAL")
    );

    const rows = visibleMemberships.map(({ roles, organization }) => {
      const { owner } = organization;
      // `organization.userId` is the workspace owner, who pays for its plan.
      const isYou = organization.userId === userId;

      return {
        organizationId: organization.id,
        // Personal workspaces carry a generic stored name; label them by kind.
        name:
          organization.type === "PERSONAL"
            ? "Personal workspace"
            : organization.name,
        type: organization.type,
        imageId: organization.imageId,
        isCurrent: organization.id === currentOrganizationId,
        roleLabel: organizationRolesMap[resolveMostPrivilegedRole(roles)] ?? "",
        plan: resolveWorkspacePlan({
          tierId: owner.tierId,
          isEnterprise: owner.customTierLimit?.isEnterprise,
        }),
        paidBy: { isYou, name: isYou ? "" : resolveUserDisplayName(owner) },
      } satisfies WorkspacePlanRow;
    });

    return sortWorkspacePlanRows(rows);
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while loading your workspaces' plans.",
      additionalData: { userId },
      label,
    });
  }
}
