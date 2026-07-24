/**
 * Team upgrade call-to-action resolution.
 *
 * A Personal workspace can never invite registered users, so every Personal
 * workspace is shown an upgrade path. Which path is correct depends on what the
 * user already pays for and whether a free trial is still available to them.
 * Getting this wrong is user-visible: offering a "trial" to someone who already
 * spent theirs dead-ends, because the subscription action rejects a second one.
 *
 * Deliberately NOT considered here: the paid add-ons (`Organization.auditsEnabled`,
 * `Organization.barcodesEnabled`). Those live on the organization and can be active
 * on a Personal workspace while the user is still on the free tier, so they make
 * someone a paying customer without changing what this resolves. They do not affect
 * entitlement to a Team workspace, which is driven purely by the tier's
 * `TierLimit.maxOrganizations`. This is also why nothing outside this function
 * should try to render "the plan" as a single label: there isn't one.
 *
 * @see {@link file://./../routes/_layout+/settings.team.tsx}
 * @see {@link file://./../routes/_layout+/account-details.subscription.tsx}
 */
import type { TierId } from "@prisma/client";

/** Where the Personal-workspace upgrade CTA should point, and what it says. */
export type TeamUpgradeCta = {
  to: string;
  label: string;
};

/**
 * Resolves the upgrade CTA for a user sitting in a Personal workspace.
 *
 * - `tier_2` / `custom`: already entitled to a Team workspace, they simply
 *   haven't created one, so send them straight to workspace creation.
 * - `free` / `tier_1` with an unused trial: starting the trial is the real
 *   action.
 * - `free` / `tier_1` who already spent the trial: it must read as an upgrade.
 *   Paying Plus customers are almost always here, and telling them to "start a
 *   trial" would be both wrong and a dead end.
 *
 * @param args.tierId - The user's subscription tier
 * @param args.usedFreeTrial - Whether the user has already consumed their trial
 * @returns The destination and label for the CTA
 */
export function resolveTeamUpgradeCta({
  tierId,
  usedFreeTrial,
}: {
  tierId: TierId;
  usedFreeTrial: boolean;
}): TeamUpgradeCta {
  const needsPlanChange = tierId === "free" || tierId === "tier_1";

  if (!needsPlanChange) {
    return {
      to: "/account-details/workspace",
      label: "Create a Team workspace",
    };
  }

  return {
    to: "/account-details/subscription",
    label: usedFreeTrial ? "Upgrade to Team" : "Start a Team trial",
  };
}
