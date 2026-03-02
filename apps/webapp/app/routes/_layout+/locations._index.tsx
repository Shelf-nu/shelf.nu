import type { Prisma } from "@prisma/client";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { data } from "react-router";
import ImageWithPreview from "~/components/image-with-preview/image-with-preview";

import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { List } from "~/components/list";
import { ListContentWrapper } from "~/components/list/content-wrapper";
import { Filters } from "~/components/list/filters";
import BulkActionsDropdown from "~/components/location/bulk-actions-dropdown";
import { LocationBadge } from "~/components/location/location-badge";
import { LocationDescriptionColumn } from "~/components/location/location-description-column";
import LocationQuickActions from "~/components/location/location-quick-actions";
import { Button } from "~/components/shared/button";
import { Td, Th } from "~/components/table";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import type { LOCATION_LIST_INCLUDE } from "~/modules/location/service.server";
import { getLocations } from "~/modules/location/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import {
  setCookie,
  updateCookieWithPerPage,
  userPrefs,
} from "~/utils/cookies.server";
import { makeShelfError } from "~/utils/error";
import { computeHasActiveFilters } from "~/utils/filter-params";
import { payload, error, getCurrentSearchParams } from "~/utils/http.server";
import { getParamsValues } from "~/utils/list";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.location,
      action: PermissionAction.read,
    });
    const searchParams = getCurrentSearchParams(request);
    const { page, perPageParam, search } = getParamsValues(searchParams);
    const hasActiveFilters = computeHasActiveFilters(searchParams);
    const cookie = await updateCookieWithPerPage(request, perPageParam);
    const { perPage } = cookie;

    const { locations, totalLocations } = await getLocations({
      organizationId,
      page,
      perPage,
      search,
    });
    const totalPages = Math.ceil(totalLocations / perPage);

    const header: HeaderData = {
      title: "Locations",
    };
    const modelName = {
      singular: "location",
      plural: "locations",
    };

    return data(
      payload({
        header,
        items: locations,
        search,
        page,
        totalItems: totalLocations,
        totalPages,
        perPage,
        modelName,
        hasActiveFilters,
      }),
      {
        headers: [setCookie(await userPrefs.serialize(cookie))],
      }
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export default function LocationsIndexPage() {
  const { isBaseOrSelfService } = useUserRoleHelper();

  return (
    <>
      <Header>
        <Button
          to="new"
          role="link"
          aria-label={`new location`}
          data-test-id="createNewLocation"
        >
          New location
        </Button>
      </Header>
      <ListContentWrapper>
        <Filters />
        <List
          bulkActions={
            isBaseOrSelfService ? undefined : <BulkActionsDropdown />
          }
          customEmptyStateContent={{
            title: "No locations yet",
            text: "Locations help you track where your assets are. Create locations to organize assets by room, building, or site.",
            newButtonRoute: "/locations/new",
            newButtonContent: "Create your first location",
          }}
          ItemComponent={ListItemContent}
          headerChildren={
            <>
              <Th>Description</Th>
              <Th>Parent location</Th>
              <Th className="whitespace-nowrap">Child locations</Th>
              <Th>Assets</Th>
              <Th>Kits</Th>
              <Th>Actions</Th>
            </>
          }
        />
      </ListContentWrapper>
    </>
  );
}

const ListItemContent = ({
  item,
}: {
  item: Prisma.LocationGetPayload<{ include: typeof LOCATION_LIST_INCLUDE }>;
}) => (
  <>
    <Td className="w-full p-0 md:p-0">
      <div className="flex justify-between gap-3 p-4 md:justify-normal md:px-6">
        <div className="flex items-center gap-3">
          <div className="flex size-12 items-center justify-center">
            <ImageWithPreview
              thumbnailUrl={item.thumbnailUrl}
              alt={`${item.name} main image`}
              className="size-full"
            />
          </div>
          <div className="flex flex-row items-center gap-2 md:flex-col md:items-start md:gap-0">
            <Button
              to={`${item.id}/assets`}
              variant="link"
              className="text-left font-medium text-gray-900 hover:text-gray-700"
            >
              {item.name}
            </Button>
            <div className="hidden text-gray-600 md:block">{item.address}</div>
          </div>
        </div>
      </div>
    </Td>
    {item.description ? (
      <LocationDescriptionColumn value={item.description} />
    ) : (
      <Td>-</Td>
    )}
    <Td>
      {item.parent ? (
        <LocationBadge
          location={{
            id: item.parent.id,
            name: item.parent.name,
            parentId: item.parent.parentId ?? undefined,
            childCount: item.parent._count?.children ?? 0,
          }}
          className="m-0"
        />
      ) : (
        "-"
      )}
    </Td>
    <Td>{item._count.children}</Td>
    <Td>{item._count.assets}</Td>
    <Td>{item._count.kits}</Td>
    <Td>
      <LocationQuickActions
        location={{
          id: item.id,
          name: item.name,
          childCount: item._count.children,
        }}
      />
    </Td>
  </>
);
