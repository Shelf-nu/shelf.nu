/**
 * Billing Section State
 *
 * Decides what the "Billed to you" part of the account subscription page
 * shows. The page answers two separate questions: which plan each workspace
 * runs on (the workspaces' plans table, always shown) and what the signed-in
 * user pays for (this section). A user who pays for nothing can still work in
 * a paid workspace someone else owns, so "no subscription" must not read as
 * "no plan".
 *
 * @see {@link file://./../../routes/_layout+/account-details.subscription.tsx}
 * @see {@link file://./own-plan-options.tsx}
 */

/**
 * What the "Billed to you" section renders:
 * - `own-plan-options`: pays for nothing, but works in a paid workspace someone
 *   else owns; offer a plan of their own without implying they lack one
 * - `choose-plan`: pays for nothing and has no paid access; the full pricing
 *   table is the upgrade screen
 * - `no-workspace-plan`: pays only for add-ons; nudge towards a workspace plan
 * - `subscribed`: nothing beyond their subscriptions list
 */
export type BillingSectionState =
  | "own-plan-options"
  | "choose-plan"
  | "no-workspace-plan"
  | "subscribed";

/**
 * Resolves what the "Billed to you" section shows.
 *
 * @param args.hasSubscription - The user has at least one Stripe subscription
 * @param args.hasWorkspacePlan - One of those subscriptions is a workspace
 *   plan (Plus or Team), not only add-ons
 * @param args.hasPaidAccessThroughOthers - The user works in a paid workspace
 *   someone else owns
 * @returns The section state
 */
export function resolveBillingSectionState({
  hasSubscription,
  hasWorkspacePlan,
  hasPaidAccessThroughOthers,
}: {
  hasSubscription: boolean;
  hasWorkspacePlan: boolean;
  hasPaidAccessThroughOthers: boolean;
}): BillingSectionState {
  if (!hasSubscription) {
    return hasPaidAccessThroughOthers ? "own-plan-options" : "choose-plan";
  }
  // Add-on-only users already have a paid workspace plan through someone
  // else; telling them they have "no workspace plan" contradicts the table.
  if (!hasWorkspacePlan && !hasPaidAccessThroughOthers) {
    return "no-workspace-plan";
  }
  return "subscribed";
}
