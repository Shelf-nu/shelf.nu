import { TierId } from "@prisma/client";
import type { Organization } from "@prisma/client";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { data , useLoaderData } from "react-router";
import ContextualModal from "~/components/layout/contextual-modal";
import { ListHeader } from "~/components/list/list-header";
import { ListItem } from "~/components/list/list-item";
import { CrispButton } from "~/components/marketing/crisp";
import { UpgradeMessage } from "~/components/marketing/upgrade-message";
import { Badge } from "~/components/shared/badge";
import { Button } from "~/components/shared/button";
import { Image } from "~/components/shared/image";
import { UserBadge } from "~/components/shared/user-badge";
import { Table, Td, Th } from "~/components/table";
import { WorkspaceActionsDropdown } from "~/components/workspace/workspace-actions-dropdown";
import { db } from "~/database/db.server";
import { useUserData } from "~/hooks/use-user-data";
import { getSelectedOrganisation } from "~/modules/organization/context.server";
import { getUserTierLimit } from "~/modules/tier/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { ShelfError, makeShelfError } from "~/utils/error";
import { payload, error } from "~/utils/http.server";
import { isPersonalOrg } from "~/utils/organization";
import { canCreateMoreOrganizations } from "~/utils/subscription.server";
import { tw } from "~/utils/tw";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    // Every user can see this view for themseleves, so we dont have to manage any permissions here
    const { organizationId } = await getSelectedOrganisation({
      userId: authSession.userId,
      request,
    });

    const user = await db.user
      .findUniqueOrThrow({
        where: {
          id: userId,
        },
        select: {
          firstName: true,
          tier: true,
          userOrganizations: {
            include: {
              organization: {
                include: {
                  _count: {
                    select: {
                      assets: true,
                      members: true,
                      locations: true,
                    },
                  },
                  owner: {
                    select: {
                      id: true,
                      firstName: true,
                      lastName: true,
                      profilePicture: true,
                    },
                  },
                },
              },
            },
          },
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          title: "User not found",
          message:
            "The user you are trying to access does not exist or you do not have permission to access it.",
          additionalData: { userId, organizationId },
          label: "Settings",
        });
      });

    const modelName = {
      singular: "Workspace",
      plural: "Workspaces",
    };

    /** Get the organization that are owned by the current uer */
    const organizations = user.userOrganizations.map((r) => r.organization);
    /** Get the tier limit */
    const tierLimit = await getUserTierLimit(userId);

    return payload({
      userId,
      tier: user.tier,
      tierLimit,
      currentOrganizationId: organizationId,
      canCreateMoreOrganizations: canCreateMoreOrganizations({
        tierLimit: tierLimit,
        totalOrganizations: organizations.filter((o) => o.owner.id === userId)
          .length,
      }),
      items: organizations,
      totalItems: organizations.length,
      modelName,
      title: "Workspace",
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.title) : "" },
];

export default function WorkspacePage() {
  const {
    items: organizations,
    canCreateMoreOrganizations,
    tier,
    tierLimit,
  } = useLoaderData<typeof loader>();
  const user = useUserData();

  let upgradeMessage: string | React.ReactNode = (
    <>
      You are currently able to have a maximum of {tierLimit.maxOrganizations}{" "}
      workspaces. If you want to create more than{" "}
      {tierLimit.maxOrganizations - 1} Team workspaces, please get in touch with{" "}
      <CrispButton variant="link">sales</CrispButton>.
    </>
  );
  if (tier.id === TierId.free || tier.id === TierId.tier_1) {
    upgradeMessage = (
      <>
        You cannot create a workspace on a {tier.name} subscription.{" "}
        <UpgradeMessage />
      </>
    );
  }

  return (
    <div>
      <div className="w-full">
        <div className="mb-2.5 flex items-center justify-between bg-white md:rounded md:border md:border-gray-200 md:px-6 md:py-5">
          <h2 className=" text-lg text-gray-900">Workspaces</h2>

          <Button
            to="new"
            role="link"
            aria-label="new workspace"
            data-test-id="createNewWorkspaceButton"
            variant="primary"
            disabled={
              !canCreateMoreOrganizations
                ? {
                    reason: upgradeMessage,
                  }
                : false
            }
          >
            New workspace
          </Button>
        </div>
        <div className="flex-1 overflow-x-auto rounded border bg-white">
          <Table>
            <ListHeader
              children={
                <>
                  <Th className="whitespace-nowrap">Owner</Th>
                  <Th>Type</Th>
                  <Th>Assets</Th>
                  <Th>Locations</Th>
                  <Th className="whitespace-nowrap">Team members</Th>
                  <Th>Actions</Th>
                </>
              }
            />
            <tbody>
              {organizations.map((org) => (
                <ListItem item={org} key={org.id}>
                  <OrganizationRow
                    item={{
                      id: org.id,
                      name:
                        org.type === "PERSONAL"
                          ? `${user?.firstName}'s workspace`
                          : org.name,
                      image:
                        org.type === "PERSONAL"
                          ? user?.profilePicture ||
                            "/static/images/default_pfp.jpg"
                          : org?.imageId || undefined,
                      _count: org._count,
                      type: org.type,
                      owner: org.owner,
                      enabledSso: org.enabledSso,
                      updatedAt: new Date(org.updatedAt),
                    }}
                  />
                </ListItem>
              ))}
            </tbody>
          </Table>
        </div>
      </div>

      <ContextualModal />
    </div>
  );
}

const OrganizationRow = ({
  item,
}: {
  item: Pick<
    Organization,
    "id" | "name" | "type" | "updatedAt" | "enabledSso"
  > & {
    image: string | undefined; // We dont pick that one as sometimes we send an id sometimes we send a placeholder
    _count: {
      assets: number | null;
      members: number | null;
      locations: number | null;
    };
    owner: {
      id: string;
      firstName: string | null;
      lastName: string | null;
      profilePicture: string | null;
    };
  };
}) => {
  const { currentOrganizationId, userId } = useLoaderData<typeof loader>();
  return (
    <>
      <Td className="w-full p-0 md:p-0">
        <div className="flex justify-between gap-3 p-4 md:justify-normal md:px-6">
          <div className="flex items-center gap-3">
            <div className="flex size-12 items-center justify-center">
              {isPersonalOrg(item) ? (
                <img
                  src={item?.image || "/static/images/default_pfp.jpg"}
                  alt={`${item.name}`}
                  className="size-12 rounded-[4px] object-cover"
                />
              ) : (
                <Image
                  imageId={item?.image}
                  alt={`${item.name}`}
                  className={tw("size-12 rounded-[4px] object-cover")}
                  updatedAt={item?.updatedAt}
                />
              )}
            </div>
            <div className="flex flex-row items-center gap-2 md:flex-col md:items-start md:gap-0">
              <div className="font-medium">
                {item.name}
                {currentOrganizationId === item?.id ? (
                  <span className="ml-2">
                    <Badge color={"#0dec5d"} withDot={false}>
                      current
                    </Badge>
                  </span>
                ) : null}
                {item.enabledSso && (
                  <span className="ml-2">
                    <Badge color={"#3ba361"} withDot={false}>
                      SSO enabled
                    </Badge>
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </Td>
      <Td>
        <UserBadge
          img={item.owner.profilePicture}
          name={`${item.owner.firstName} ${item.owner.lastName}`}
        />
      </Td>

      <Td>{item.type}</Td>
      <Td>{item._count?.assets || 0}</Td>
      <Td>{item._count?.locations || 0}</Td>
      <Td>{item._count?.members || 0}</Td>
      <Td>
        {userId === item.owner.id && item.type !== "PERSONAL" ? (
          <WorkspaceActionsDropdown workspaceId={item.id} />
        ) : (
          " "
        )}
      </Td>
    </>
  );
};
