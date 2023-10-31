import type { Asset, Image as ImageDataType, Location } from "@prisma/client";
import { json } from "@remix-run/node";
import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { useNavigate } from "@remix-run/react";

import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { List } from "~/components/list";
import { Button } from "~/components/shared/button";
import { Image } from "~/components/shared/image";
import { Td, Th } from "~/components/table";

import { requireAuthSession } from "~/modules/auth";
import { getLocations } from "~/modules/location";
import { requireOrganisationId } from "~/modules/organization/context.server";
import {
  generatePageMeta,
  getCurrentSearchParams,
  getParamsValues,
  tw,
} from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { updateCookieWithPerPage, userPrefs } from "~/utils/cookies.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const authSession = await requireAuthSession(request);
  const { organizationId } = await requireOrganisationId(authSession, request);
  const searchParams = getCurrentSearchParams(request);
  const { page, perPageParam, search } = getParamsValues(searchParams);
  const cookie = await updateCookieWithPerPage(request, perPageParam);
  const { perPage } = cookie;

  const { prev, next } = generatePageMeta(request);

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
    {
      header,
      items: locations,
      search,
      page,
      totalItems: totalLocations,
      totalPages,
      perPage,
      prev,
      next,
      modelName,
    },
    {
      headers: {
        "Set-Cookie": await userPrefs.serialize(cookie),
      },
    }
  );
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export default function LocationsIndexPage() {
  const navigate = useNavigate();
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
          Add Location
        </Button>
      </Header>
      <div className="mt-8 flex flex-1 flex-col md:mx-0 md:gap-2">
        <List
          ItemComponent={ListItemContent}
          navigate={(itemId) => navigate(itemId)}
          headerChildren={
            <>
              <Th>Assets</Th>
            </>
          }
        />
      </div>
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
          <div className="flex h-12 w-12 items-center justify-center">
            <Image
              imageId={item.imageId}
              alt="img"
              className={tw(
                "h-full w-full rounded-[4px] border object-cover",
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
