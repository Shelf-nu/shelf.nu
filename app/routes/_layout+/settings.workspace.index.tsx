import type { OrganizationType } from "@prisma/client";
import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { ErrorBoundryComponent } from "~/components/errors";
import ContextualModal from "~/components/layout/contextual-modal";
import { ListHeader } from "~/components/list/list-header";
import { ListItem } from "~/components/list/list-item";
import { Badge } from "~/components/shared";
import { PremiumFeatureButton } from "~/components/subscription/premium-feature-button";
import { Table, Td, Th } from "~/components/table";
import { db } from "~/database";
import { useUserData } from "~/hooks";
import { requireAuthSession } from "~/modules/auth";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { ShelfStackError } from "~/utils/error";
import { canCreateMoreOrganizations } from "~/utils/subscription";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { userId, organizationId } = await requireAuthSession(request);

  const user = await db.user.findUnique({
    where: {
      id: userId,
    },
    select: {
      firstName: true,
      tier: {
        include: { tierLimit: true },
      },
      organizations: {
        include: {
          _count: {
            select: {
              assets: true,
              members: true,
            },
          },
        },
      },
    },
  });

  // const organizations = await getUserOrganizationsWithDetailedData({ userId });

  if (!user || user.organizations?.length < 1)
    throw new ShelfStackError({ message: "Organization not found" });

  const modelName = {
    singular: "Workspace",
    plural: "Workspaces",
  };

  return json({
    currentOrganizationId: organizationId,
    canCreateMoreOrganizations: canCreateMoreOrganizations({
      tierLimit: user?.tier?.tierLimit,
      totalOrganizations: user?.organizations?.length,
    }),
    organizations: user?.organizations,
    items: user.organizations,
    totalItems: user.organizations.length,
    modelName,
    title: "Workspace",
  });
};

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.title) : "" },
];
export const ErrorBoundary = () => <ErrorBoundryComponent />;

export default function WorkspacePage() {
  const { organizations, canCreateMoreOrganizations } =
    useLoaderData<typeof loader>();
  const user = useUserData();
  const navigate = useNavigate();

  return (
    <div>
      <div className="w-full">
        <div className="mb-2.5 flex items-center justify-between bg-white md:rounded-[12px] md:border md:border-gray-200 md:px-6 md:py-5">
          <h2 className=" text-lg text-gray-900">Workspaces</h2>
          <PremiumFeatureButton
            canUseFeature={canCreateMoreOrganizations}
            buttonContent={{
              title: "New workspace",
              message:
                "You are currently able to create a max of 2 workspaces. If you want to create more than 1 Team workspace, please get in touch with sales",
            }}
            skipCta
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
        <div className="flex-1 rounded-[12px] border">
          <Table>
            <ListHeader
              children={
                <>
                  <Th className="hidden md:table-cell">Type</Th>
                  <Th className="hidden md:table-cell">Assets</Th>
                  <Th className="hidden md:table-cell">Locations</Th>
                  <Th className="hidden whitespace-nowrap md:table-cell">
                    Team members
                  </Th>
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
                          : org?.imageId
                          ? `/api/image/${org.imageId}`
                          : "/images/default_pfp.jpg",
                      _count: org._count,
                      type: org.type,
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
  item: {
    id: string;
    name: string;
    image: string;
    type: OrganizationType;
    _count: {
      assets: number | null;
      members: number | null;
    };
  };
}) => {
  const { currentOrganizationId } = useLoaderData<typeof loader>();
  return (
    <>
      <Td className="w-full p-0 md:p-0">
        <div className="flex justify-between gap-3 p-4 md:justify-normal md:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center">
              <img
                src={item?.image || "/images/default_pfp.jpg"}
                alt={`${item.name}`}
                className="h-12 w-12 rounded-[4px] object-cover"
              />
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
      <Td>{item.type}</Td>
      <Td>{item._count?.assets || 0}</Td>
      <Td>""</Td>
      <Td>{item._count?.members || 0}</Td>
    </>
  );
};
