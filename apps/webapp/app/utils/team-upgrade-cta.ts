/**
 * Team upgrade call-to-action resolution.
 *
 * A Personal workspace can never invite registered users, so every Personal
 * workspace is shown an upgrade path. Which path is correct depends on whether
 * the user is already entitled to a Team workspace and, if not, whether a free
 * trial is still available to them. Getting this wrong is user-visible:
 * offering a "trial" to someone who already spent theirs dead-ends, because the
 * subscription action rejects a second one.
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

/** Where the Personal-workspace upgrade CTA should point, and what it says. */
export type TeamUpgradeCta = {
  to: string;
  label: string;
};

/**
 * Resolves the upgrade CTA for a user sitting in a Personal workspace.
 *
 * - Entitled to a Team workspace: they simply haven't created one, so send
 *   them straight to workspace creation.
 * - Not entitled, trial unused: starting the trial is the real action.
 * - Not entitled, trial already spent: it must read as an upgrade. Paying Plus
 *   customers are almost always here, and telling them to "start a trial"
 *   would be both wrong and a dead end.
 *
 * Entitlement is passed in rather than derived from a tier id, because a tier
 * id does not determine it. `TierLimit.maxOrganizations` is a database column
 * an admin can edit per tier, `CustomTierLimit` overrides it per user, and a
 * deployment with premium features disabled entitles everyone. Deciding here
 * from `tierId` would make this a second, quietly wrong source of truth — and
 * would send a self-hosted user to a billing page that redirects away.
 *
 * @param args.canCreateTeamWorkspace - Whether the user's plan permits a Team
 *   workspace at all. Note this is entitlement, NOT remaining headroom: a
 *   Team-tier user who already created their one Team workspace is still
 *   entitled, and must not be told to upgrade.
 * @param args.usedFreeTrial - Whether the user has already consumed their trial
 * @returns The destination and label for the CTA
 */
export function resolveTeamUpgradeCta({
  canCreateTeamWorkspace,
  usedFreeTrial,
}: {
  canCreateTeamWorkspace: boolean;
  usedFreeTrial: boolean;
}): TeamUpgradeCta {
  if (canCreateTeamWorkspace) {
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
