import type { Prisma } from "@prisma/client";
import type { LoaderFunctionArgs } from "react-router";
import { data, Outlet, useLoaderData, useParams } from "react-router";
import { ErrorContent } from "~/components/errors";
import HorizontalTabs from "~/components/layout/horizontal-tabs";
import { TeamUpgradeBanner } from "~/components/settings/team-upgrade-banner";
import When from "~/components/when/when";
import { getUserTierLimit } from "~/modules/tier/service.server";
import { getUserByID } from "~/modules/user/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { userPrefs } from "~/utils/cookies.server";
import { makeShelfError } from "~/utils/error";
import { payload, error } from "~/utils/http.server";
import {
  TEAM_LAYOUT_GATES,
  visibleTeamTabs,
} from "~/utils/permissions/settings-tabs";
import { requireAnyPermission } from "~/utils/roles.server";
import { premiumIsEnabled } from "~/utils/subscription.server";
import { resolveTeamUpgradeCta } from "~/utils/team-upgrade-cta";

export const meta = () => [{ title: appendToMetaTitle("Team settings") }];

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;
  try {
    // Admits a member who can see at least one Team tab. Each Team page keeps
    // its own gate, so this layout grants nothing by itself.
    const { currentOrganization, roles } = await requireAnyPermission({
      userId,
      request,
      anyOf: TEAM_LAYOUT_GATES,
    });

    const isPersonalOrg = currentOrganization.type === "PERSONAL";

    /**
     * Personal workspaces see an upgrade teaser. Which CTA is correct depends
     * on the user's tier and whether a trial is still available to them.
     */
    let upgradeCta = {
      to: "/account-details/subscription",
      label: "Start a Team trial",
    };
    if (isPersonalOrg) {
      const [user, tierLimit] = await Promise.all([
        getUserByID(userId, {
          select: {
            usedFreeTrial: true,
          } satisfies Prisma.UserSelect,
        }),
        getUserTierLimit(userId),
      ]);

      /**
       * Entitlement, not remaining headroom. `maxOrganizations` counts the
       * Personal workspace, so anything above 1 permits a Team workspace —
       * the same arithmetic `/account-details/workspace` shows the user.
       * A Team-tier user who already created their one Team workspace is
       * still entitled and must not be told to upgrade.
       *
       * With premium features off (self-hosted) nothing is gated, and
       * `/account-details/subscription` redirects away, so the only CTA that
       * leads anywhere is workspace creation.
       */
      const canCreateTeamWorkspace =
        !premiumIsEnabled || tierLimit.maxOrganizations > 1;

      upgradeCta = resolveTeamUpgradeCta({
        canCreateTeamWorkspace,
        usedFreeTrial: user.usedFreeTrial,
      });
    }

    const userPrefsCookie =
      (await userPrefs.parse(request.headers.get("Cookie"))) || {};

    return payload({
      isPersonalOrg,
      orgName: currentOrganization.name,
      upgradeCtaTo: upgradeCta.to,
      upgradeCtaLabel: upgradeCta.label,
      upgradeBannerCollapsed: !!userPrefsCookie.teamUpgradeBannerCollapsed,
      tabs: visibleTeamTabs({ roles, isPersonalOrg }).map(
        ({ to, content }) => ({ to, content })
      ),
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw data(error(reason), { status: reason.status });
  }
};

export default function TeamSettings() {
  const {
    isPersonalOrg,
    orgName,
    upgradeCtaTo,
    upgradeCtaLabel,
    upgradeBannerCollapsed,
    tabs,
  } = useLoaderData<typeof loader>();

  const params = useParams();

  return (
    <>
      <When truthy={!params.userId}>
        <div className="rounded border bg-white p-4 md:px-10 md:py-8">
          <h1 className="text-[18px] font-semibold">
            {isPersonalOrg ? "Team" : `${orgName}’s team`}
          </h1>
          {/*
            A Personal workspace has no team to manage, so the standard line
            promises something the banner below it immediately withdraws. It
            still has custody, which is what the page is good for there.
          */}
          <p className="mb-6 text-sm text-gray-600">
            {isPersonalOrg
              ? "Track who has custody of your assets."
              : "Manage your existing team and give team members custody to certain assets."}
          </p>
          {isPersonalOrg ? (
            <TeamUpgradeBanner
              ctaTo={upgradeCtaTo}
              ctaLabel={upgradeCtaLabel}
              collapsed={upgradeBannerCollapsed}
            />
          ) : null}
          <HorizontalTabs items={tabs} />
          <Outlet />
        </div>
      </When>
      <When truthy={!!params?.userId?.length}>
        <Outlet />
      </When>
    </>
  );
}
export const ErrorBoundary = () => <ErrorContent />;
