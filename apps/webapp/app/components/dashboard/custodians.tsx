import { useLoaderData } from "react-router";
import { useCurrentOrganization } from "~/hooks/use-current-organization";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import type { loader } from "~/routes/_layout+/home";
import { isPersonalOrg } from "~/utils/organization";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { resolveTeamMemberName } from "~/utils/user";
import { ClickableTr } from "./clickable-tr";
import { DashboardEmptyState } from "./empty-state";
import { PremiumFeatureTeaser } from "../home/premium-feature-teaser";
import { Button } from "../shared/button";

import { Table, Td, Tr } from "../table";

export default function CustodiansList() {
  const { custodiansData } = useLoaderData<typeof loader>();
  const { roles } = useUserRoleHelper();
  const currentOrganization = useCurrentOrganization();
  const isPersonal = isPersonalOrg(currentOrganization);
  const canViewTeamMemberUsers = userHasPermission({
    roles,
    entity: PermissionEntity.teamMemberProfile,
    action: PermissionAction.read,
  });
  return (
    <div className="flex h-full flex-col rounded border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b px-4 py-3 md:px-6">
        <span className="text-[14px] font-semibold text-gray-900">
          Top custodians
        </span>
        <div className="flex items-center gap-2">
          {!isPersonal && (
            <Button
              to="/settings/team"
              variant="block-link-gray"
              className="!mt-0 text-xs"
            >
              View all
            </Button>
          )}
        </div>
      </div>

      {isPersonal ? (
        <div className="flex flex-1 items-center justify-center p-4">
          <PremiumFeatureTeaser
            headline="Track who has what"
            description="Add non-registered members to assign asset custody, or create a Team workspace to invite users with full access."
            ctaLabel="Add a member"
            ctaTo="/settings/team/nrm"
            secondaryLabel="Or create a Team workspace →"
            secondaryTo="/account-details/workspace"
          />
        </div>
      ) : custodiansData.length > 0 ? (
        <Table className="flex-1">
          <tbody>
            {custodiansData.map((cd) => {
              const link =
                canViewTeamMemberUsers && cd.custodian.userId
                  ? `/settings/team/users/${cd.custodian.userId}/assets`
                  : null;
              const rowContent = (
                <Row
                  custodian={cd.custodian}
                  count={cd.count}
                  canNavigate={canViewTeamMemberUsers}
                />
              );
              return link ? (
                <ClickableTr key={cd.id} className="h-[72px]" to={link}>
                  {rowContent}
                </ClickableTr>
              ) : (
                <Tr key={cd.id} className="h-[72px]">
                  {rowContent}
                </Tr>
              );
            })}
            {custodiansData.length < 5 &&
              Array(5 - custodiansData.length)
                .fill(null)
                .map((_d, i) => (
                  <Tr key={i} className="h-[72px]">
                    {""}
                  </Tr>
                ))}
          </tbody>
        </Table>
      ) : (
        <div className="flex flex-1 items-center justify-center p-4">
          <DashboardEmptyState
            text="No assets in custody"
            subText="Assign custody of assets to team members to track who has what."
            ctaTo="/assets"
            ctaText="Go to assets"
          />
        </div>
      )}
    </div>
  );
}

function Row({
  custodian,
  count,
  canNavigate,
}: {
  custodian: {
    name: string;
    userId?: string | null;
    user?: {
      firstName?: string | null;
      lastName?: string | null;
      profilePicture?: string | null;
    } | null;
  };
  count: number;
  /** Does the current user have permissions to acess this teamMember page */
  canNavigate: boolean;
}) {
  const teamMemberName = resolveTeamMemberName(custodian);
  return (
    <>
      <Td className="w-full">
        <div className="flex items-center justify-between">
          <span className="text-text-sm font-medium text-gray-900">
            <div className="flex items-center gap-3">
              <img
                src={
                  custodian?.user?.profilePicture
                    ? custodian?.user?.profilePicture
                    : "/static/images/default_pfp.jpg"
                }
                className={"size-10 rounded-[4px]"}
                alt={`${resolveTeamMemberName(custodian)}'s profile`}
              />
              <div>
                <span className="word-break block">
                  {canNavigate && custodian.userId ? (
                    <Button
                      to={`/settings/team/users/${custodian.userId}/assets`}
                      variant="link"
                      className="text-left font-medium text-gray-900 hover:text-gray-700"
                      target={"_blank"}
                      onlyNewTabIconOnHover={true}
                    >
                      {teamMemberName}
                    </Button>
                  ) : (
                    <span className="mt-px">{teamMemberName}</span>
                  )}
                </span>
                <span className="block text-gray-600">{count} Assets</span>
              </div>
            </div>
          </span>
        </div>
      </Td>
      <Td>{""}</Td>
    </>
  );
}
