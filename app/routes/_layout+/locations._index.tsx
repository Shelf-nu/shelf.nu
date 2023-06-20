
import type { LoaderArgs } from "@remix-run/node";
import { json, type V2_MetaFunction } from "@remix-run/node";
import { useNavigate } from "@remix-run/react";

import type { Location } from "@prisma/client";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { List } from "~/components/list";

import { Button } from "~/components/shared/button";
import { requireAuthSession } from "~/modules/auth";
import { getLocations } from "~/modules/location";
import {
  generatePageMeta,
  getCurrentSearchParams,
  getParamsValues,
} from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export async function loader({ request }: LoaderArgs) {
  const { userId } = await requireAuthSession(request);

  const searchParams = getCurrentSearchParams(request);
  const { page, perPage, search } = getParamsValues(searchParams);
  const { prev, next } = generatePageMeta(request);

  const { locations, totalLocations } = await getLocations({
    userId,
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
  return json({
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
  });
}

export const meta: V2_MetaFunction<typeof loader> = ({ data }) => [
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
          aria-label={`new asset`}
          icon="location"
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
              <th className="hidden border-b p-4 text-left font-normal text-gray-600 md:table-cell md:px-6">
                Assets
              </th>
            </>
          }
        />
      </div>
    </>
  );
}

const ListItemContent = ({ item }: { item: Location }) => {
  return (
    <>
      <td className="w-full  border-b">
        <div className="flex justify-between gap-3 p-4 md:justify-normal md:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-[4px] border">
              <img
                src="/images/asset-placeholder.jpg"
                alt="img"
                className="h-10 w-10 rounded-[4px] object-cover"
              />
            </div>
            <div className="flex flex-row items-center gap-2 md:flex-col md:items-start md:gap-0">
              <div className="font-medium">{item.name}</div>
              <div className="hidden text-gray-600 md:block">
                {item.address}
              </div>
              <div className="block md:hidden">54</div>
            </div>
          </div>
        </div>
      </td>
      <td className="hidden whitespace-nowrap border-b p-4 md:table-cell md:px-6">
        54
      </td>
    </>
  );
};
