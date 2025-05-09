import type { Prisma } from "@prisma/client";
import { KitStatus, OrganizationRoles } from "@prisma/client";
import { json, redirect } from "@remix-run/node";
import type { MetaFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Link } from "@remix-run/react";
import { StatusFilter } from "~/components/booking/status-filter";
import DynamicDropdown from "~/components/dynamic-dropdown/dynamic-dropdown";
import { ChevronRight } from "~/components/icons/library";
import BulkActionsDropdown from "~/components/kits/bulk-actions-dropdown";
import KitImage from "~/components/kits/kit-image";
import KitQuickActions from "~/components/kits/kit-quick-actions";
import { KitStatusBadge } from "~/components/kits/kit-status-badge";
import Header from "~/components/layout/header";
import LineBreakText from "~/components/layout/line-break-text";
import { List } from "~/components/list";
import { ListContentWrapper } from "~/components/list/content-wrapper";
import { Filters } from "~/components/list/filters";
import { Button } from "~/components/shared/button";
import { Td, Th } from "~/components/table";
import { TeamMemberBadge } from "~/components/user/team-member-badge";
import { db } from "~/database/db.server";
import { useCurrentOrganization } from "~/hooks/use-current-organization-id";
import { useUserData } from "~/hooks/use-user-data";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import {
  getPaginatedAndFilterableKits,
  updateKitsWithBookingCustodians,
} from "~/modules/kit/service.server";
import type { KITS_INCLUDE_FIELDS } from "~/modules/kit/types";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError, ShelfError } from "~/utils/error";
import { data, error, getCurrentSearchParams } from "~/utils/http.server";
import { userHasCustodyViewPermission } from "~/utils/permissions/custody-and-bookings-permissions.validator.client";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { requirePermission } from "~/utils/roles.server";
import { tw } from "~/utils/tw";
import { resolveTeamMemberName } from "~/utils/user";
import type { MergeInclude } from "~/utils/utils";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId, role } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.kit,
      action: PermissionAction.read,
    });

    const searchParams = getCurrentSearchParams(request);

    let [
      { kits, totalKits, perPage, page, totalPages, search },
      teamMembers,
      totalTeamMembers,
    ] = await Promise.all([
      getPaginatedAndFilterableKits({
        request,
        organizationId,
        extraInclude: {
          qrCodes: { select: { id: true } },
          assets: {
            select: { id: true, availableToBook: true, status: true },
          },
        },
      }),
      db.teamMember
        .findMany({
          where: {
            deletedAt: null,
            organizationId,
            userId:
              role === OrganizationRoles.SELF_SERVICE ? userId : undefined,
          },
          include: { user: true },
          orderBy: { userId: "asc" },
          take: searchParams.get("getAll") === "teamMember" ? undefined : 12,
        })
        .catch((cause) => {
          throw new ShelfError({
            cause,
            message:
              "Something went wrong while fetching team members. Please try again or contact support.",
            additionalData: { userId, organizationId },
            label: "Assets",
          });
        }),
      db.teamMember.count({ where: { deletedAt: null, organizationId } }),
    ]);

    if (totalPages !== 0 && page > totalPages) {
      return redirect("/kits");
    }

    kits = await updateKitsWithBookingCustodians(kits);

    const header = {
      title: "Kits",
    };

    const modelName = {
      singular: "kit",
      plural: "kits",
    };

    return json(
      data({
        header,
        items: kits,
        page,
        totalItems: totalKits,
        totalPages,
        perPage,
        modelName,
        search,
        searchFieldLabel: "Search kits",
        teamMembers,
        totalTeamMembers,
        searchFieldTooltip: {
          title: "Search your kits database",
          text: "Search kits based on name or description.",
        },
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data?.header.title) },
];

export default function KitsIndexPage() {
  const { roles, isBase } = useUserRoleHelper();
  const canCreateKit = userHasPermission({
    roles,
    entity: PermissionEntity.kit,
    action: PermissionAction.create,
  });

  const organization = useCurrentOrganization();
  const user = useUserData();

  // @TODO - this needs to be resolved
  // const canReadCustody = userHasCustodyViewPermission({
  //   roles,
  //   custodianUser: teamMember?.user,
  //   organization,
  //   currentUserId: user?.id,
  // });
  return (
    <>
      <Header>
        {canCreateKit && (
          <Button to="new" role="link" aria-label="new kit" icon="kit">
            New kit
          </Button>
        )}
      </Header>

      <ListContentWrapper>
        <Filters
          slots={{
            "left-of-search": (
              <StatusFilter
                statusItems={{
                  [KitStatus.AVAILABLE]: KitStatus.AVAILABLE,
                  [KitStatus.IN_CUSTODY]: KitStatus.IN_CUSTODY,
                }}
              />
            ),
          }}
        >
          {/* {canReadCustody && ( */}
          <DynamicDropdown
            trigger={
              <div className="flex cursor-pointer items-center gap-2">
                Custodian{" "}
                <ChevronRight className="hidden rotate-90 md:inline" />
              </div>
            }
            model={{ name: "teamMember", queryKey: "name", deletedAt: null }}
            label="Filter by custodian"
            placeholder="Search team members"
            countKey="totalTeamMembers"
            initialDataKey="teamMembers"
            transformItem={(item) => ({
              ...item,
              id: item.metadata?.userId ? item.metadata.userId : item.id,
            })}
            renderItem={(item) => resolveTeamMemberName(item, true)}
          />
          {/* )} */}
        </Filters>

        <List
          className="overflow-x-visible md:overflow-x-auto"
          ItemComponent={ListContent}
          bulkActions={isBase ? undefined : <BulkActionsDropdown />}
          headerChildren={
            <>
              <Th>Description</Th>
              <Th>Assets</Th>
              <Th>Custodian</Th>
              <Th>Actions</Th>
            </>
          }
        />
      </ListContentWrapper>
    </>
  );
}

function ListContent({
  item,
  bulkActions,
}: {
  item: Prisma.KitGetPayload<{
    include: MergeInclude<
      typeof KITS_INCLUDE_FIELDS,
      {
        qrCodes: { select: { id: true } };
        assets: {
          select: { id: true; availableToBook: true; status: true };
        };
      }
    >;
  }>;
  bulkActions?: React.ReactNode;
}) {
  return (
    <>
      <Td className="w-full whitespace-normal p-0 md:p-0">
        <Link
          to={`/kits/${item.id}`}
          className={tw(
            "flex justify-between gap-3 py-4  md:justify-normal",
            bulkActions ? "md:pl-0 md:pr-6" : "md:px-6"
          )}
        >
          <div className="flex items-center gap-3">
            <div className="flex size-12 shrink-0 items-center justify-center">
              <KitImage
                className="size-full rounded-[4px] border object-cover"
                kit={{
                  image: item.image,
                  imageExpiration: item.imageExpiration,
                  alt: item.name,
                  kitId: item.id,
                }}
              />
            </div>
            <div className="min-w-[130px]">
              <span className="word-break mb-1 block font-medium">
                {item.name}
              </span>
              <div>
                <KitStatusBadge
                  status={item.status}
                  availableToBook={!item.assets.some((a) => !a.availableToBook)}
                />
              </div>
            </div>
          </div>
        </Link>
      </Td>
      <Td className="max-w-62 md:max-w-96">
        {item.description ? (
          <LineBreakText
            className="md:max-w-96"
            text={item.description}
            numberOfLines={3}
            charactersPerLine={60}
          />
        ) : null}
      </Td>
      <Td>{item._count.assets}</Td>
      <Td>
        <TeamMemberBadge teamMember={item?.custody?.custodian} />
      </Td>

      <Td>
        <KitQuickActions
          kit={{
            ...item,
            qrId: item?.qrCodes[0]?.id,
          }}
        />
      </Td>
    </>
  );
}
