/**
 * Workspace Plans
 *
 * Pure helpers for the "Your workspaces' plans" table on the account
 * subscription page. A workspace has no plan of its own: it runs on its
 * owner's tier, the same rule `getOrganizationTierLimit` applies when it
 * gates features. So an admin invited into a paid Team workspace is on that
 * Team plan inside it, even while their own account is Free.
 *
 * Client-safe: shared by the server loader that builds the rows and the React
 * components that render them, so it must never import a `*.server` module.
 *
 * @see {@link file://./../modules/billing/workspace-plans.server.ts}
 * @see {@link file://./../modules/tier/service.server.ts}
 * @see {@link file://./../routes/_layout+/account-details.subscription.tsx}
 */

import type { OrganizationType, TierId } from "@prisma/client";

/** The plan name shown for a workspace. */
export type WorkspacePlanLabel =
  | "Free"
  | "Plus"
  | "Team"
  | "Custom"
  | "Enterprise";

/** A workspace's plan: the owner's tier and the label users see for it. */
export type WorkspacePlan = { tierId: TierId; label: WorkspacePlanLabel };

/** One row of the workspaces' plans table. */
export type WorkspacePlanRow = {
  organizationId: string;
  name: string;
  type: OrganizationType;
  imageId: string | null;
  /** Whether this is the workspace the user currently has selected. */
  isCurrent: boolean;
  /** The signed-in user's role in this workspace, e.g. "Administrator". */
  roleLabel: string;
  plan: WorkspacePlan;
  /**
   * Who pays for the workspace's plan: always the workspace owner.
   * `name` is the owner's display name, and empty when `isYou` is true.
   */
  paidBy: { isYou: boolean; name: string };
};

/**
 * Resolves the plan label for a workspace from its owner's tier.
 *
 * `custom` tiers are labelled "Enterprise" when the owner's custom tier limit
 * is flagged as enterprise, and "Custom" otherwise.
 *
 * @param args.tierId - The workspace owner's tier
 * @param args.isEnterprise - The owner's `customTierLimit.isEnterprise`, if any
 * @returns The tier and its user-facing label
 */
export function resolveWorkspacePlan({
  tierId,
  isEnterprise,
}: {
  tierId: TierId;
  isEnterprise?: boolean | null;
}): WorkspacePlan {
  switch (tierId) {
    case "free":
      return { tierId, label: "Free" };
    case "tier_1":
      return { tierId, label: "Plus" };
    case "tier_2":
      return { tierId, label: "Team" };
    case "custom":
      return { tierId, label: isEnterprise ? "Enterprise" : "Custom" };
  }
}

/**
 * Orders workspace plan rows for display: the current workspace first, then
 * Team workspaces before Personal ones, then by name.
 *
 * @param rows - The rows to order; not mutated
 * @returns A new, sorted array
 */
export function sortWorkspacePlanRows(
  rows: WorkspacePlanRow[]
): WorkspacePlanRow[] {
  return [...rows].sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    if (a.type !== b.type) return a.type === "TEAM" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Finds a paid workspace the user works in that someone else pays for. It is
 * the reason a user whose own subscription is Free still has paid features,
 * so the subscription page names it and offers the user a plan of their own.
 *
 * @param rows - The user's workspace plan rows, already sorted so the current
 *   workspace wins when it qualifies
 * @returns The first workspace owned by another user on a paid tier, or `null`
 */
export function findPaidWorkspaceThroughOthers(
  rows: WorkspacePlanRow[]
): WorkspacePlanRow | null {
  return (
    rows.find((row) => !row.paidBy.isYou && row.plan.tierId !== "free") ?? null
  );
}
