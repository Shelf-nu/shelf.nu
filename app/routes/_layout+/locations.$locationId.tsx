import type { Asset, Category, Tag, Location } from "@prisma/client";
import { json, redirect } from "@remix-run/node";
import type {
  ActionFunctionArgs,
  LinksFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import mapCss from "maplibre-gl/dist/maplibre-gl.css?url";
import { z } from "zod";
import { AssetImage } from "~/components/assets/asset-image";
import ContextualModal from "~/components/layout/contextual-modal";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { List } from "~/components/list";
import { Filters } from "~/components/list/filters";
import { ActionsDropdown } from "~/components/location/actions-dropdown";
import { ShelfMap } from "~/components/location/map";
import { MapPlaceholder } from "~/components/location/map-placeholder";
import { Badge } from "~/components/shared/badge";
import { Button } from "~/components/shared/button";
import { Card } from "~/components/shared/card";
import { Image } from "~/components/shared/image";
import { Tag as TagBadge } from "~/components/shared/tag";
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
    const { page, perPageParam, search } = getParamsValues(searchParams);
    const cookie = await updateCookieWithPerPage(request, perPageParam);
    const { perPage } = cookie;

    const { location, totalAssetsWithinLocation } = await getLocation({
      organizationId,
      id,
      page,
      perPage,
      search,
      userOrganizations,
      request,
    });

    const totalItems = totalAssetsWithinLocation;
    const totalPages = Math.ceil(totalAssetsWithinLocation / perPage);

    const header: HeaderData = {
      title: location.name,
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
    await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.location,
      action: PermissionAction.delete,
    });

    await deleteLocation({ id });

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
  const navigate = useNavigate();

  return (
    <div>
      <Header>
        <ActionsDropdown location={location} />
      </Header>
      <ContextualModal />

      <div className="mt-8 block lg:flex">
        <div className="shrink-0 overflow-hidden lg:w-[250px] 2xl:w-[400px]">
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
              <div className="mt-4 flex items-center justify-between gap-10 rounded border border-gray-200 px-4 py-5">
                <span className=" text-xs font-medium text-gray-600">
                  Address
                </span>
                <span className="font-medium">{location.address}</span>
              </div>
              {mapData ? (
                <div className="mb-10 mt-4">
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
                <div className="mb-10 mt-4">
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

        <div className=" w-full lg:ml-8 lg:w-[calc(100%-282px)]">
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
            <Filters className="responsive-filters mb-2 lg:mb-0">
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
              navigate={(itemId) => navigate(`/assets/${itemId}`)}
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
            <div className="relative flex size-12 shrink-0 items-center justify-center">
              <AssetImage
                asset={{
                  assetId: item.id,
                  mainImage: item.mainImage,
                  mainImageExpiration: item.mainImageExpiration,
                  alt: item.title,
                }}
                className="size-full rounded-[4px] border object-cover"
              />
            </div>
            <div className="min-w-[180px]">
              <span className="word-break mb-1 block font-medium">
                <Button
                  to={`/assets/${item.id}`}
                  variant="link"
                  className="text-left text-gray-900 hover:text-gray-700"
                >
                  {item.title}
                </Button>
              </span>
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

const ListItemTagsColumn = ({ tags }: { tags: Tag[] | undefined }) => {
  const visibleTags = tags?.slice(0, 2);
  const remainingTags = tags?.slice(2);

  return tags && tags?.length > 0 ? (
    <div className="">
      {visibleTags?.map((tag) => (
        <TagBadge key={tag.name} className="mr-2">
          {tag.name}
        </TagBadge>
      ))}
      {remainingTags && remainingTags?.length > 0 ? (
        <TagBadge
          className="mr-2 w-6 text-center"
          title={`${remainingTags?.map((t) => t.name).join(", ")}`}
        >
          {`+${tags.length - 2}`}
        </TagBadge>
      ) : null}
    </div>
  ) : null;
};
