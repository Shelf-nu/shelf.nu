/**
 * Team plan notice for the subscription page.
 *
 * Shown to an invited member of one or more paid Team workspaces who has no
 * workspace plan of their own. Shelf bills the workspace owner, so the member
 * is covered by the team's plan; this notice says so in place of the "FREE
 * version" message and the inline pricing table, which would otherwise invite
 * them to buy a plan they do not need. The plans stay one click away for
 * anyone who wants a workspace of their own.
 *
 * @see {@link file://./../../routes/_layout+/account-details.subscription.tsx}
 * @see {@link file://./../../modules/user/paid-team-memberships.ts} for who counts as covered
 */
import { Fragment } from "react";
import { InfoIcon } from "~/components/icons/library";
import { Button } from "~/components/shared/button";
import type { PaidTeamMembership } from "~/modules/user/paid-team-memberships";

/**
 * The separator placed before the name at `index` in a list of `count` names:
 * nothing before the first, " and " before the last, ", " otherwise.
 * Produces "A", "A and B", "A, B and C".
 */
function separatorBefore(index: number, count: number): string {
  if (index === 0) return "";
  return index === count - 1 ? " and " : ", ";
}

/**
 * Tells a covered member that their team's plan covers them.
 *
 * @param props.teams - The paid Team workspaces the user is a member of. The
 *   caller renders this only when the list is not empty.
 * @param props.onViewPlans - Opens the pricing dialog
 */
export function TeamPlanNotice({
  teams,
  onViewPlans,
}: {
  teams: PaidTeamMembership[];
  onViewPlans: () => void;
}) {
  const hasSeveralTeams = teams.length > 1;

  return (
    <div className="mb-2 mt-3 flex flex-col gap-3 rounded border border-gray-300 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <div className="inline-flex shrink-0 items-center justify-center rounded-full border-[5px] border-solid border-primary-50 bg-primary-100 p-1.5 text-primary">
          <InfoIcon />
        </div>
        <div>
          <p className="text-[14px] font-medium text-gray-700">
            Your team's plan covers you
          </p>
          <p className="text-[13px] text-gray-500">
            You're a member of{" "}
            {teams.map((team, index) => (
              <Fragment key={team.id}>
                {separatorBefore(index, teams.length)}
                <span className="font-semibold text-gray-700">{team.name}</span>
              </Fragment>
            ))}
            .{" "}
            {hasSeveralTeams
              ? "The workspace owners pay for their plans"
              : "The workspace owner pays for its plan"}
            , so you don't need a plan of your own.
          </p>
        </div>
      </div>
      <Button
        type="button"
        variant="secondary"
        className="self-start whitespace-nowrap sm:self-auto"
        onClick={onViewPlans}
      >
        View plans
      </Button>
    </div>
  );
}
