import type { Prisma } from "@prisma/client";
import { KitStatus } from "@prisma/client";
import { json, redirect } from "@remix-run/node";
import type {
  MetaFunction,
  LoaderFunctionArgs,
  LinksFunction,
} from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { useKitAvailabilityData } from "~/components/assets/assets-index/use-kit-availability-data";
import { AvailabilityViewToggle } from "~/components/assets/assets-index/view-toggle";
import { CategoryBadge } from "~/components/assets/category-badge";
import AvailabilityCalendar from "~/components/availability-calendar/availability-calendar";
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
import { Pagination } from "~/components/list/pagination";
import { Button } from "~/components/shared/button";
import { Card } from "~/components/shared/card";
import { GrayBadge } from "~/components/shared/gray-badge";
import { InfoTooltip } from "~/components/shared/info-tooltip";
import { Tag } from "~/components/shared/tag";
import { Td, Th } from "~/components/table";
import { TeamMemberBadge } from "~/components/user/team-member-badge";
import { db } from "~/database/db.server";
import { useCurrentOrganization } from "~/hooks/use-current-organization";
import { useIsAvailabilityView } from "~/hooks/use-is-availability-view";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { getLocationsForCreateAndEdit } from "~/modules/asset/service.server";
import {
  getPaginatedAndFilterableKits,
  updateKitsWithBookingCustodians,
} from "~/modules/kit/service.server";
import type { KITS_INCLUDE_FIELDS } from "~/modules/kit/types";
import calendarStyles from "~/styles/layout/calendar.css?url";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { getFiltersFromRequest, setCookie } from "~/utils/cookies.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { payload, error, getCurrentSearchParams } from "~/utils/http.server";
import type { OrganizationPermissionSettings } from "~/utils/permissions/custody-and-bookings-permissions.validator.client";
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

export type KitIndexLoaderData = typeof loader;

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: calendarStyles },
];

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId, canSeeAllCustody } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.kit,
      action: PermissionAction.read,
    });

    const searchParams = getCurrentSearchParams(request);
    const view = searchParams.get("view") ?? "table";
    const {
      filters,
      redirectNeeded,
      serializedCookie: filtersCookie,
    } = await getFiltersFromRequest(request, organizationId, {
      name: "kitFilter",
      path: "/kits",
    });

    /** We only do that when we are on the index page */
    if (filters && redirectNeeded) {
      const cookieParams = new URLSearchParams(filters);
      return redirect(`/kits?${cookieParams.toString()}`);
    }

    let [
      { kits, totalKits, perPage, page, totalPages, search },
      teamMembers,
      totalTeamMembers,
      { locations, totalLocations },
    ] = await Promise.all([
      getPaginatedAndFilterableKits({
        request,
        organizationId,
        extraInclude: {
          qrCodes: { select: { id: true } },
          assets: {
            select: {
              id: true,
              availableToBook: true,
              status: true,
              ...(view === "availability" && {
                bookings: {
                  where: {
                    status: { in: ["RESERVED", "ONGOING", "OVERDUE"] },
                  },
                  select: {
                    id: true,
                    name: true,
                    status: true,
                    from: true,
                    to: true,
                    description: true,
                    custodianTeamMember: true,
                    custodianUser: true,
                  },
                },
              }),
            },
          },
          category: true,
          location: true,
        },
      }),
      db.teamMember
        .findMany({
          where: {
            deletedAt: null,
            organizationId,
            userId: !canSeeAllCustody ? userId : undefined,
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
      getLocationsForCreateAndEdit({
        organizationId,
        request,
      }),
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
      payload({
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
        locations,
        totalLocations,
      }),
      {
        headers: [...(filtersCookie ? [setCookie(filtersCookie)] : [])],
      }
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data?.header.title) },
];

export const handle = {
  name: "kits.index",
};

export default function KitsIndexPage() {
  const { items } = useLoaderData<typeof loader>();
  const { roles, isBase } = useUserRoleHelper();
  const canCreateKit = userHasPermission({
    roles,
    entity: PermissionEntity.kit,
    action: PermissionAction.create,
  });
  const { isAvailabilityView, shouldShowAvailabilityView } =
    useIsAvailabilityView();
  const { resources, events } = useKitAvailabilityData(items);

  const organization = useCurrentOrganization();

  const canReadCustody = userHasCustodyViewPermission({
    roles,
    organization: organization as OrganizationPermissionSettings,
  });

  return (
    <>
      <Header>
        {canCreateKit && (
          <Button to="new" role="link" aria-label="new kit">
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
            "right-of-search": <AvailabilityViewToggle />,
          }}
        >
          {canReadCustody && (
            <DynamicDropdown
              trigger={
                <div className="my-2 flex cursor-pointer items-center gap-2 md:my-0">
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
          )}
        </Filters>
        {isAvailabilityView && shouldShowAvailabilityView ? (
          <>
            <AvailabilityCalendar
              resources={resources}
              events={events}
              resourceLabelContent={({ resource }) => (
                <div className="flex items-center gap-2 px-2">
                  <KitImage
                    kit={{
                      kitId: resource.id,
                      image: resource.extendedProps?.mainImage,
                      imageExpiration:
                        resource.extendedProps?.mainImageExpiration,
                      alt: resource.title,
                    }}
                    alt={resource.title}
                    className="size-14 rounded border object-cover"
                    withPreview
                  />
                  <div className="flex flex-col gap-1">
                    <div className="min-w-0 flex-1 truncate">
                      <Button
                        to={`/kits/${resource.id}/assets`}
                        variant="link"
                        className="text-left font-medium text-gray-900 hover:text-gray-700"
                        target={"_blank"}
                        onlyNewTabIconOnHover={true}
                      >
                        {resource.title}
                      </Button>
                    </div>
                    <div className="flex items-center gap-2">
                      <KitStatusBadge
                        status={resource.extendedProps?.status}
                        availableToBook={
                          resource.extendedProps?.availableToBook
                        }
                      />
                    </div>
                  </div>
                </div>
              )}
            />
            <Card className="-mt-2 border-t-0 py-0">
              <Pagination />
            </Card>
          </>
        ) : (
          <List
            className="overflow-x-visible md:overflow-x-auto"
            ItemComponent={ListContent}
            bulkActions={isBase ? undefined : <BulkActionsDropdown />}
            headerChildren={
              <>
                <Th>Category</Th>
                <Th>Location</Th>
                <Th>Description</Th>
                <Th>Assets</Th>
                <Th className="flex items-center gap-1 whitespace-nowrap">
                  Custodian{" "}
                  <InfoTooltip
                    iconClassName="size-4"
                    content={
                      <>
                        <h6>Asset custody</h6>
                        <p>
                          This column shows if a user has custody of the asset
                          either via direct assignment or via a booking. If you
                          see <GrayBadge>private</GrayBadge> that means you
                          don't have the permissions to see who has custody of
                          the asset.
                        </p>
                      </>
                    }
                  />
                </Th>
                <Th>Actions</Th>
              </>
            }
          />
        )}
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
        category: true;
        location: true;
      }
    >;
  }>;
  bulkActions?: React.ReactNode;
}) {
  return (
    <>
      <Td className="w-full whitespace-normal p-0 md:p-0">
        <Link
          to={`/kits/${item.id}/assets`}
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

      <Td>
        <CategoryBadge category={item.category} />
      </Td>

      <Td>
        {item.location ? (
          <Tag className="mb-0">{item.location.name}</Tag>
        ) : null}
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
