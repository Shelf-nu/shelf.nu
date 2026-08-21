import { OrganizationRoles } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { UsersIcon } from "lucide-react";
import type { LoaderFunctionArgs } from "react-router";
import { data, Outlet, useLoaderData, useParams } from "react-router";
import { ErrorContent } from "~/components/errors";
import { PremiumFeatureTeaser } from "~/components/home/premium-feature-teaser";
import HorizontalTabs from "~/components/layout/horizontal-tabs";
import type { Item } from "~/components/layout/horizontal-tabs/types";
import When from "~/components/when/when";
import { getUserByID } from "~/modules/user/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError } from "~/utils/error";
import { payload, error } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { resolveTeamUpgradeCta } from "~/utils/team-upgrade-cta";

export type UserFriendlyRoles =
  | "Administrator"
  | "Owner"
  | "Base"
  | "Self service";
export const meta = () => [{ title: appendToMetaTitle("Team settings") }];

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;
  try {
    const { currentOrganization } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.teamMember,
      action: PermissionAction.read,
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
      const user = await getUserByID(userId, {
        select: {
          tierId: true,
          usedFreeTrial: true,
        } satisfies Prisma.UserSelect,
      });
      upgradeCta = resolveTeamUpgradeCta({
        tierId: user.tierId,
        usedFreeTrial: user.usedFreeTrial,
      });
    }

    return payload({
      isPersonalOrg,
      orgName: currentOrganization.name,
      upgradeCtaTo: upgradeCta.to,
      upgradeCtaLabel: upgradeCta.label,
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw data(error(reason), { status: reason.status });
  }
};

export const organizationRolesMap: Record<string, UserFriendlyRoles> = {
  [OrganizationRoles.ADMIN]: "Administrator",
  [OrganizationRoles.OWNER]: "Owner",
  [OrganizationRoles.BASE]: "Base",
  [OrganizationRoles.SELF_SERVICE]: "Self service",
};

export default function TeamSettings() {
  const { isPersonalOrg, orgName, upgradeCtaTo, upgradeCtaLabel } =
    useLoaderData<typeof loader>();

  const TABS: Item[] = [
    ...(!isPersonalOrg
      ? [
          { to: "users", content: "Users" },
          { to: "invites", content: "Invites" },
        ]
      : []),
    { to: "nrm", content: "Non-registered members" },
  ];

  const params = useParams();

  return (
    <>
      <When truthy={!params.userId}>
        <div className="rounded border bg-white p-4 md:px-10 md:py-8">
          <h1 className="text-[18px] font-semibold">
            {isPersonalOrg ? "Team" : `${orgName}’s team`}
          </h1>
          <p className="mb-6 text-sm text-gray-600">
            Manage your existing team and give team members custody to certain
            assets.
          </p>
          {isPersonalOrg ? (
            <div className="mb-6 rounded-lg border border-gray-200 bg-gray-50 py-8">
              <PremiumFeatureTeaser
                icon={<UsersIcon className="size-5" />}
                headline="Inviting people needs a Team workspace"
                description="Your workspace is Personal, meant for one person. Create a Team workspace to invite teammates, assign custody, and manage bookings together."
                ctaLabel={upgradeCtaLabel}
                ctaTo={upgradeCtaTo}
              />
            </div>
          ) : null}
          <HorizontalTabs items={TABS} />
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
