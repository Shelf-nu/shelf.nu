import type { Asset, Image as ImageDataType, Location } from "@prisma/client";
import { json } from "@remix-run/node";
import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { useNavigate } from "@remix-run/react";

import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { List } from "~/components/list";
import { ListContentWrapper } from "~/components/list/content-wrapper";
import { Filters } from "~/components/list/filters";
import BulkActionsDropdown from "~/components/location/bulk-actions-dropdown";
import { Button } from "~/components/shared/button";
import { Image } from "~/components/shared/image";
import { Td, Th } from "~/components/table";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { getLocations } from "~/modules/location/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import {
  setCookie,
  updateCookieWithPerPage,
  userPrefs,
} from "~/utils/cookies.server";
import { makeShelfError } from "~/utils/error";
import { data, error, getCurrentSearchParams } from "~/utils/http.server";
import { getParamsValues } from "~/utils/list";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { tw } from "~/utils/tw";

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

    return json(
      data({
        header,
        items: locations,
        search,
        page,
        totalItems: totalLocations,
        totalPages,
        perPage,

        modelName,
      }),
      {
        headers: [setCookie(await userPrefs.serialize(cookie))],
      }
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export default function LocationsIndexPage() {
  const navigate = useNavigate();
  const { isBaseOrSelfService } = useUserRoleHelper();

  return (
    <>
      <Header>
        <Button
          to="new"
          role="link"
          aria-label={`new location`}
          icon="plus"
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
          ItemComponent={ListItemContent}
          navigate={(itemId) => navigate(itemId)}
          headerChildren={
            <>
              <Th>Assets</Th>
            </>
          }
        />
      </ListContentWrapper>
    </>
  );
}

interface LocationWithAssets extends Location {
  assets: Asset[];
  image?: ImageDataType;
}

const ListItemContent = ({ item }: { item: LocationWithAssets }) => (
  <>
    <Td className="w-full p-0 md:p-0">
      <div className="flex justify-between gap-3 p-4 md:justify-normal md:px-6">
        <div className="flex items-center gap-3">
          <div className="flex size-12 items-center justify-center">
            <Image
              imageId={item.imageId}
              alt="img"
              className={tw(
                "size-full rounded-[4px] border object-cover",
                item.description ? "rounded-b-none border-b-0" : ""
              )}
              updatedAt={item.image?.updatedAt}
            />
          </div>
          <div className="flex flex-row items-center gap-2 md:flex-col md:items-start md:gap-0">
            <div className="font-medium">{item.name}</div>
            <div className="hidden text-gray-600 md:block">{item.address}</div>
          </div>
        </div>
      </div>
    </Td>
    <Td>{item.assets.length}</Td>
  </>
);
