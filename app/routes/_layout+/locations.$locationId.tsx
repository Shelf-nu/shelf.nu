import type { Asset, Category, Tag, Location } from "@prisma/client";
import { json, redirect } from "@remix-run/node";
import type {
  ActionFunctionArgs,
  LinksFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import mapCss from "maplibre-gl/dist/maplibre-gl.css?url";
import { z } from "zod";
import { AssetImage } from "~/components/assets/asset-image/component";
import { AssetStatusBadge } from "~/components/assets/asset-status-badge";
import { ASSET_INDEX_SORTING_OPTIONS } from "~/components/assets/assets-index/filters";
import ContextualModal from "~/components/layout/contextual-modal";
import ContextualSidebar from "~/components/layout/contextual-sidebar";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { List } from "~/components/list";
import { Filters } from "~/components/list/filters";
import { SortBy } from "~/components/list/filters/sort-by";
import { ActionsDropdown } from "~/components/location/actions-dropdown";
import { ShelfMap } from "~/components/location/map";
import { MapPlaceholder } from "~/components/location/map-placeholder";
import { Badge } from "~/components/shared/badge";
import { Button } from "~/components/shared/button";
import { Card } from "~/components/shared/card";
import { Image } from "~/components/shared/image";
import TextualDivider from "~/components/shared/textual-divider";
import { Td, Th } from "~/components/table";
import { deleteLocation, getLocation } from "~/modules/location/service.server";
import assetCss from "~/styles/asset.css?url";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import {
  setCookie,
  updateCookieWithPerPage,
  userPrefs,
} from "~/utils/cookies.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { geolocate } from "~/utils/geolocate.server";
import {
  data,
  error,
  getCurrentSearchParams,
  getParams,
} from "~/utils/http.server";
import { getParamsValues } from "~/utils/list";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { tw } from "~/utils/tw";
import { ListItemTagsColumn } from "./assets._index";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { locationId: id } = getParams(
    params,
    z.object({ locationId: z.string() }),
    {
      additionalData: { userId },
    }
  );

  try {
    const { organizationId, userOrganizations } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.location,
      action: PermissionAction.read,
    });

    const searchParams = getCurrentSearchParams(request);
    const { page, perPageParam, search, orderBy, orderDirection } =
      getParamsValues(searchParams);
    const cookie = await updateCookieWithPerPage(request, perPageParam);
    const { perPage } = cookie;

    const { location, totalAssetsWithinLocation } = await getLocation({
      organizationId,
      id,
      page,
      perPage,
      search,
      orderBy,
      orderDirection,
      userOrganizations,
      request,
    });

    const totalItems = totalAssetsWithinLocation;
    const totalPages = Math.ceil(totalAssetsWithinLocation / perPage);

    const header: HeaderData = {
      title: location.name,
      subHeading: location.id,
    };

    const modelName = {
      singular: "asset",
      plural: "assets",
    };

    const mapData = await geolocate(location.address);

    return json(
      data({
        location,
        header,
        modelName,
        items: location.assets,
        page,
        totalItems,
        perPage,
        totalPages,
        mapData,
      }),
      {
        headers: [setCookie(await userPrefs.serialize(cookie))],
      }
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, id });
    throw json(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data?.header?.title) },
];

export const handle = {
  breadcrumb: () => "single",
};

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: mapCss },
  { rel: "stylesheet", href: assetCss },
];

export async function action({ context, request, params }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { locationId: id } = getParams(
    params,
    z.object({ locationId: z.string() }),
    {
      additionalData: { userId },
    }
  );

  try {
    const { organizationId } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.location,
      action: PermissionAction.delete,
    });

    await deleteLocation({ id, organizationId });

    sendNotification({
      title: "Location deleted",
      message: "Your location has been deleted successfully",
      icon: { name: "trash", variant: "error" },
      senderId: authSession.userId,
    });

    return redirect(`/locations`);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, id });
    return json(error(reason), { status: reason.status });
  }
}

export default function LocationPage() {
  const { location, mapData } = useLoaderData<typeof loader>();

  return (
    <div>
      <Header>
        <ActionsDropdown location={location} />
      </Header>
      <ContextualModal />
      <ContextualSidebar />

      <div className="mx-[-16px] mt-4 block md:mx-0 lg:flex">
        {/* Left column - assets list */}
        <div className=" flex-1 overflow-hidden">
          <TextualDivider text="Assets" className="mb-8 lg:hidden" />
          <div className="mb-3 flex gap-4 lg:hidden">
            <Button as="button" to="add-assets" variant="primary" width="full">
              Manage assets
            </Button>
            <div className="w-full">
              <ActionsDropdown location={location} fullWidth />
            </div>
          </div>
          <div className="flex flex-col md:gap-2">
            <Filters
              className="responsive-filters mb-2 lg:mb-0"
              slots={{
                "right-of-search": (
                  <SortBy
                    sortingOptions={ASSET_INDEX_SORTING_OPTIONS}
                    defaultSortingBy="createdAt"
                  />
                ),
              }}
            >
              <div className="flex items-center justify-normal gap-6 xl:justify-end">
                <div className="hidden lg:block">
                  <Button
                    as="button"
                    to="add-assets"
                    variant="primary"
                    className="whitespace-nowrap"
                  >
                    Manage assets
                  </Button>
                </div>
              </div>
            </Filters>
            <List
              ItemComponent={ListAssetContent}
              headerChildren={
                <>
                  <Th>Category</Th>
                  <Th>Tags</Th>
                </>
              }
              customEmptyStateContent={{
                title: "There are currently no assets at the location",
                text: "Add assets in this location",
                newButtonRoute: "add-assets",
                newButtonContent: "Add asset",
              }}
            />
          </div>
        </div>
        {/* Right column - Location info */}
        <div className="w-full md:w-[360px] lg:ml-4">
          <Image
            imageId={location?.imageId}
            alt={`${location.name}`}
            className={tw(
              "block h-auto w-full rounded border object-cover 2xl:h-auto",
              location.description ? "rounded-b-none border-b-0" : ""
            )}
            updatedAt={location.image?.updatedAt}
          />
          {location.description ? (
            <Card className=" mt-0 md:rounded-t-none">
              <p className=" text-gray-600">{location.description}</p>
            </Card>
          ) : null}

          <TextualDivider text="Details" className="my-8 lg:hidden" />

          {location.address ? (
            <>
              <div className="mt-4 flex items-start justify-between gap-10 rounded border border-gray-200 bg-white px-4 py-5">
                <span className=" text-xs font-medium text-gray-600">
                  Address
                </span>
                <span className="font-medium">{location.address}</span>
              </div>
              {mapData ? (
                <div className="mb-10 mt-4 border">
                  <ShelfMap latitude={mapData.lat} longitude={mapData.lon} />
                  <div className="border border-gray-200 p-4 text-center text-text-xs text-gray-600">
                    <p>
                      <Button
                        to={`https://www.google.com/maps/search/?api=1&query=${mapData.lat},${mapData.lon}&zoom=15&markers=${mapData.lat},${mapData.lon}`}
                        variant="link"
                        target="_blank"
                        rel="nofollow noopener noreferrer"
                      >
                        See in Google Maps
                      </Button>
                    </p>
                  </div>
                </div>
              ) : (
                <div className="mb-10 mt-4 border">
                  <MapPlaceholder
                    description={
                      "We couldn't geolocate your address. Please try formatting it differently."
                    }
                  />
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const ListAssetContent = ({
  item,
}: {
  item: Asset & {
    category?: Category;
    tags?: Tag[];
    location?: Location;
  };
}) => {
  const { category, tags } = item;
  return (
    <>
      <Td className="w-full whitespace-normal p-0 md:p-0">
        <div className="flex justify-between gap-3 p-4  md:justify-normal md:px-6">
          <div className="flex items-center gap-3">
            <div className="relative flex size-14 shrink-0 items-center justify-center">
              <AssetImage
                asset={{
                  id: item.id,
                  mainImage: item.mainImage,
                  thumbnailImage: item.thumbnailImage,
                  mainImageExpiration: item.mainImageExpiration,
                }}
                alt={item.title}
                className="size-full rounded-[4px] border object-cover"
                withPreview
              />
            </div>
            <div className="min-w-[180px]">
              <span className="word-break mb-1 block font-medium">
                <Button
                  to={`/assets/${item.id}`}
                  variant="link"
                  className="text-left text-gray-900 hover:text-gray-700"
                  target="_blank"
                  onlyNewTabIconOnHover={true}
                >
                  {item.title}
                </Button>
              </span>
              <AssetStatusBadge
                status={item.status}
                availableToBook={item.availableToBook}
              />
            </div>
          </div>
        </div>
      </Td>

      <Td>
        {category ? (
          <Badge color={category.color} withDot={false}>
            {category.name}
          </Badge>
        ) : null}
      </Td>
      <Td className="text-left">
        <ListItemTagsColumn tags={tags} />
      </Td>
    </>
  );
};
