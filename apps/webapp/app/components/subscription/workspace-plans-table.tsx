/**
 * Workspace Plans Table
 *
 * Lists every workspace the signed-in user belongs to, with the plan that
 * workspace runs on, the user's role in it and who pays for it. A workspace's
 * plan belongs to its owner's subscription, so an invited admin of a paid Team
 * workspace sees "Team" here even though they pay for nothing themselves.
 *
 * Presentational only: rows are built server-side.
 *
 * @see {@link file://./../../utils/workspace-plans.ts}
 * @see {@link file://./../../routes/_layout+/account-details.subscription.tsx}
 */
import { Badge } from "~/components/shared/badge";
import { Button } from "~/components/shared/button";
import { Image } from "~/components/shared/image";
import { Td, Th } from "~/components/table";
import { BADGE_COLORS } from "~/utils/badge-colors";
import type { BadgeColorScheme } from "~/utils/badge-colors";
import { toneBadgeColors } from "~/utils/status-tone-colors";
import type {
  WorkspacePlanLabel,
  WorkspacePlanRow,
} from "~/utils/workspace-plans";

/** Badge colors per plan. Paid plans carry a color, Free stays neutral. */
const PLAN_BADGE_COLORS: Record<WorkspacePlanLabel, BadgeColorScheme> = {
  Free: BADGE_COLORS.gray,
  Plus: BADGE_COLORS.blue,
  Team: BADGE_COLORS.indigo,
  Custom: BADGE_COLORS.violet,
  Enterprise: BADGE_COLORS.violet,
};

/**
 * Renders the plan name as a colored badge.
 *
 * @param label - The user-facing plan name
 */
export function WorkspacePlanBadge({ label }: { label: WorkspacePlanLabel }) {
  const colors = PLAN_BADGE_COLORS[label];
  return (
    <Badge color={colors.bg} textColor={colors.text} withDot={false}>
      {label}
    </Badge>
  );
}

/** Marks the workspace the user has selected, in the shared success tone. */
const CURRENT_BADGE_COLORS = toneBadgeColors("success");

/**
 * Table of the user's workspaces and the plan each one is on.
 *
 * @param rows - One row per workspace the user belongs to
 * @param onUpgradePersonal - Opens the pricing table; offered as a subtle link
 *   on the user's own free personal workspace
 * @returns The table section, or `null` when there are no rows
 */
export function WorkspacePlansTable({
  rows,
  onUpgradePersonal,
}: {
  rows: WorkspacePlanRow[];
  onUpgradePersonal?: () => void;
}) {
  if (rows.length === 0) {
    return null;
  }

  return (
    <section>
      <h3 className="text-text-lg font-semibold">Your workspaces' plans</h3>
      <p className="text-sm text-gray-600">
        A workspace's plan is paid for by its owner. Everyone in the workspace
        gets its features.
      </p>

      <div className="mt-4 overflow-x-auto rounded border border-gray-200 bg-white">
        <table className="w-full table-auto border-collapse">
          <thead>
            <tr>
              <Th className="whitespace-nowrap">Workspace</Th>
              <Th className="whitespace-nowrap">Plan</Th>
              <Th className="whitespace-nowrap">Your role</Th>
              <Th className="whitespace-nowrap">Paid by</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.organizationId}>
                <Td>
                  <div className="flex items-center gap-3">
                    {/* Personal workspaces have no logo of their own */}
                    {row.type === "PERSONAL" && !row.imageId ? (
                      <img
                        src="/static/images/default_pfp.jpg"
                        alt=""
                        className="size-8 shrink-0 rounded-[4px] object-cover"
                      />
                    ) : (
                      <Image
                        imageId={row.imageId}
                        alt=""
                        className="size-8 shrink-0 rounded-[4px] object-cover"
                      />
                    )}
                    <span className="min-w-0 truncate font-medium text-gray-900">
                      {row.name}
                    </span>
                    {row.isCurrent ? (
                      <span className="shrink-0">
                        <Badge
                          color={CURRENT_BADGE_COLORS.bg}
                          textColor={CURRENT_BADGE_COLORS.text}
                          withDot={false}
                        >
                          Current
                        </Badge>
                      </span>
                    ) : null}
                  </div>
                </Td>
                <Td>
                  <WorkspacePlanBadge label={row.plan.label} />
                </Td>
                <Td>{row.roleLabel}</Td>
                <Td>
                  <PaidByLabel row={row} onUpgradePersonal={onUpgradePersonal} />
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * Who pays for a workspace's plan. A workspace on the free tier is paid for by
 * no one, so naming its owner there would suggest a bill that doesn't exist.
 *
 * @param props.row - The workspace row
 * @param props.onUpgradePersonal - Opens the pricing table from the user's own
 *   free personal workspace
 */
function PaidByLabel({
  row,
  onUpgradePersonal,
}: {
  row: WorkspacePlanRow;
  onUpgradePersonal?: () => void;
}) {
  if (row.plan.tierId === "free") {
    const canUpgrade =
      onUpgradePersonal && row.paidBy.isYou && row.type === "PERSONAL";
    return (
      <span className="inline-flex flex-wrap items-center gap-x-2">
        No one
        {canUpgrade ? (
          <Button
            type="button"
            variant="link-gray"
            className="w-auto text-sm font-normal underline"
            onClick={onUpgradePersonal}
          >
            Upgrade to Plus
          </Button>
        ) : null}
      </span>
    );
  }
  if (row.paidBy.isYou) return <>You</>;
  return <>{`${row.paidBy.name} (owner)`}</>;
}
