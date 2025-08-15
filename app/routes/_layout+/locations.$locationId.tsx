import { ActionFunctionArgs, LinksFunction } from "@remix-run/node";
import {
  json,
  MetaFunction,
  Outlet,
  useLoaderData,
  useMatches,
} from "@remix-run/react";
import { LoaderFunctionArgs, redirect } from "react-router";
import { z } from "zod";
import ImageWithPreview from "~/components/image-with-preview/image-with-preview";
import Header from "~/components/layout/header";
import { HeaderData } from "~/components/layout/header/types";
import HorizontalTabs from "~/components/layout/horizontal-tabs";
import { ActionsDropdown } from "~/components/location/actions-dropdown";
import { ShelfMap } from "~/components/location/map";
import { MapPlaceholder } from "~/components/location/map-placeholder";
import { Button } from "~/components/shared/button";
import { Card } from "~/components/shared/card";
import TextualDivider from "~/components/shared/textual-divider";
import { deleteLocation, getLocation } from "~/modules/location/service.server";
import { RouteHandleWithName } from "~/modules/types";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import {
  setCookie,
  updateCookieWithPerPage,
  userPrefs,
} from "~/utils/cookies.server";
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
import mapCss from "maplibre-gl/dist/maplibre-gl.css?url";
import assetCss from "~/styles/asset.css?url";
import { sendNotification } from "~/utils/emitter/send-notification.server";

const paramsSchema = z.object({ locationId: z.string() });

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const { userId } = context.getSession();
  const { locationId } = getParams(params, paramsSchema);

  try {
    const { organizationId, userOrganizations } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.location,
      action: PermissionAction.read,
    });

    const searchParams = getCurrentSearchParams(request);
    const { page, perPageParam, search, orderBy, orderDirection } =
      getParamsValues(searchParams);
    const cookie = await updateCookieWithPerPage(request, perPageParam);
    const { perPage } = cookie;

    const { location } = await getLocation({
      organizationId,
      id: locationId,
      page,
      perPage,
      search,
      orderBy,
      orderDirection,
      userOrganizations,
      request,
    });

    const header: HeaderData = {
      title: location.name,
      subHeading: location.id,
    };

    const mapData = await geolocate(location.address);

    return json(
      data({
        location,
        header,
        mapData,
      }),
      {
        headers: [setCookie(await userPrefs.serialize(cookie))],
      }
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, locationId });
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

  const matches = useMatches();
  const currentRoute: RouteHandleWithName = matches[matches.length - 1];

  const items = [
    { to: "assets", content: "Assets" },
    { to: "kits", content: "Kits" },
  ];

  /**
   * When we are on the location.scan-assets route, we render an outlet on the whole layout.
   */
  if (currentRoute?.handle?.name === "location.scan-assets") {
    return <Outlet />;
  }

  return (
    <div>
      <Header
        slots={{
          "left-of-title": (
            <ImageWithPreview
              className="mr-2"
              imageUrl={location.imageUrl ?? undefined}
              thumbnailUrl={location.thumbnailUrl ?? undefined}
              alt={location.name}
              withPreview
            />
          ),
        }}
      >
        <ActionsDropdown location={location} />
      </Header>

      <HorizontalTabs items={items} />

      <div className="mt-4 block md:mx-0 lg:flex">
        {/* Left column */}
        <div className="flex-1 md:overflow-hidden">
          <Outlet />
        </div>

        {/* Right Column - Location info */}
        <div className="w-full md:w-[360px] lg:ml-4">
          {location.description ? (
            <Card className=" mt-0 md:rounded-t-none">
              <p className=" text-gray-600">{location.description}</p>
            </Card>
          ) : null}

          <TextualDivider text="Details" className="my-8 lg:hidden" />

          <div className="flex items-start justify-between gap-10 rounded border border-gray-200 bg-white px-4 py-5">
            <span className=" text-xs font-medium text-gray-600">Address</span>
            <span className="font-medium">{location.address ?? "-"}</span>
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
                  location.address
                    ? "We couldn't geolocate your address. Please try formatting it differently."
                    : "Add an address to see it on the map."
                }
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
