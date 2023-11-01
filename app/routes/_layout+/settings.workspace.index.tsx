import { TierId, type Organization } from "@prisma/client";
import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { ErrorBoundryComponent } from "~/components/errors";
import ContextualModal from "~/components/layout/contextual-modal";
import { ListHeader } from "~/components/list/list-header";
import { ListItem } from "~/components/list/list-item";
import { Badge } from "~/components/shared";
import { Image } from "~/components/shared/image";
import { UserBadge } from "~/components/shared/user-badge";
import { PremiumFeatureButton } from "~/components/subscription/premium-feature-button";
import { Table, Td, Th } from "~/components/table";
import { WorkspaceActionsDropdown } from "~/components/workspace/workspace-actions-dropdown";
import { db } from "~/database";
import { useUserData } from "~/hooks";
import { requireAuthSession } from "~/modules/auth";
import { requireOrganisationId } from "~/modules/organization/context.server";
import { tw } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { ShelfStackError } from "~/utils/error";
import { isPersonalOrg } from "~/utils/organization";
import { canCreateMoreOrganizations } from "~/utils/subscription";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const authSession = await requireAuthSession(request);
  const { organizationId } = await requireOrganisationId(authSession, request);
  const { userId } = authSession;

  const user = await db.user.findUnique({
    where: {
      id: userId,
    },
    select: {
      firstName: true,
      tier: {
        include: { tierLimit: true },
      },
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
  });

  if (!user || user.userOrganizations?.length < 1)
    throw new ShelfStackError({ message: "Organization not found" });

  const modelName = {
    singular: "Workspace",
    plural: "Workspaces",
  };
  const organizations = user.userOrganizations.map((r) => r.organization);

  return json({
    userId,
    tier: user?.tier,
    currentOrganizationId: organizationId,
    canCreateMoreOrganizations: canCreateMoreOrganizations({
      tierLimit: user?.tier?.tierLimit,
      totalOrganizations: organizations?.length,
    }),
    items: organizations,
    totalItems: organizations.length,
    modelName,
    title: "Workspace",
  });
};

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.title) : "" },
];
export const ErrorBoundary = () => <ErrorBoundryComponent />;

export default function WorkspacePage() {
  const {
    items: organizations,
    canCreateMoreOrganizations,
    tier,
  } = useLoaderData<typeof loader>();
  const user = useUserData();

  let upgradeMessage =
    "You are currently able to create a max of 2 workspaces. If you want to create more than 1 Team workspace, please get in touch with sales";
  if (tier.id === TierId.free || tier.id === TierId.tier_1) {
    upgradeMessage = `You cannot create a workspace on a ${tier.name} subscription. `;
  }

  return (
    <div>
      <div className="w-full">
        <div className="mb-2.5 flex items-center justify-between bg-white md:rounded-[12px] md:border md:border-gray-200 md:px-6 md:py-5">
          <h2 className=" text-lg text-gray-900">Workspaces</h2>
          <PremiumFeatureButton
            canUseFeature={canCreateMoreOrganizations}
            buttonContent={{
              title: "New workspace",
              message: upgradeMessage,
              ctaText: "upgrading to team plan",
            }}
            skipCta={tier.id === TierId.tier_2}
            buttonProps={{
              to: "new",
              role: "link",
              icon: "plus",
              "aria-label": `new workspace`,
              "data-test-id": "createNewWorkspaceButton",
              variant: "primary",
            }}
          />
        </div>
        <div className="flex-1 overflow-x-auto rounded-[12px] border bg-white">
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
                          ? user?.profilePicture || "/images/default_pfp.jpg"
                          : org?.imageId || "/images/default_pfp.jpg",
                      _count: org._count,
                      type: org.type,
                      owner: org.owner,
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
  item: Pick<Organization, "id" | "name" | "type" | "updatedAt"> & {
    image: string; // We dont pick that one as sometimes we send an id sometimes we send a placeholder
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
            <div className="flex h-12 w-12 items-center justify-center">
              {isPersonalOrg(item) ? (
                <img
                  src={item?.image || "/images/default_pfp.jpg"}
                  alt={`${item.name}`}
                  className="h-12 w-12 rounded-[4px] object-cover"
                />
              ) : (
                <Image
                  imageId={item?.image}
                  alt={`${item.name}`}
                  className={tw("h-12 w-12 rounded-[4px] object-cover")}
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
