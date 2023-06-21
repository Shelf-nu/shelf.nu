import {
  json,
  type LinksFunction,
  type LoaderArgs,
  type V2_MetaFunction,
} from "@remix-run/node";
import mapCss from "maplibre-gl/dist/maplibre-gl.css";
import { ActionsDopdown } from "~/components/locations/actions-dropdown";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { Badge, Button } from "~/components/shared";
import { Card } from "~/components/shared/card";
import { requireAuthSession } from "~/modules/auth";
import { getLocation } from "~/modules/location";
import { getRequiredParam, tw } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { ShelfMap } from "~/components/assets/location/map";
import { List } from "~/components/list/list";
import { Asset, Category, Tag } from "@prisma/client";
import { ChevronRight } from "~/components/icons";
import { Tag as TagBadge } from "~/components/shared/tag";
import assetCss from "~/styles/asset.css";

export const loader = async ({ request, params }: LoaderArgs) => {
  const { userId } = await requireAuthSession(request);
  const id = getRequiredParam(params, "locationId");
  const location = await getLocation({ userId, id });
  if (!location) {
    throw new Response("Not Found", { status: 404 });
  }
  const header: HeaderData = {
    title: location.name,
  };

  const modelName = {
    singular: "item",
    plural: "items",
  };

  const items = [
    {
      id: "clj41xxks000ug7b074y0wdlv",
      title: "Nikon DSLR Camera",
      description:
        "Purchased on 1st feb 2023.\r\n" +
        "To be used for product photography in the office.",
      mainImage: null,
      mainImageExpiration: null,
      createdAt: "2023-06-20T08:57:17.848Z",
      updatedAt: "2023-06-20T11:08:10.436Z",
      userId: "56cfecc4-61ed-441a-972c-e4511b1fc7b4",
      categoryId: "clj40mjnl0000g7b09dkqjsg1",
      locationId: null,
      category: {
        id: "clj40mjnl0000g7b09dkqjsg1",
        name: "Office Equipment",
        description:
          "Items that are used for office work, such as computers, printers, scanners, phones, etc.",
        color: "#ab339f",
        createdAt: "2023-06-20T08:20:27.009Z",
        updatedAt: "2023-06-20T08:20:27.009Z",
        userId: "56cfecc4-61ed-441a-972c-e4511b1fc7b4",
      },
      tags: [
        {
          createdAt: "2023-06-20T08:21:56.111Z",
          description: "",
          id: "clj40ogfk000sg7b02fudki6f",
          name: "Tech",
          updatedAt: "2023-06-20T08:21:56.111Z",
          userId: "56cfecc4-61ed-441a-972c-e4511b1fc7b4",
        },
      ],
    },
    {
      id: "clj41xxks000ug7b074y0wd34v",
      title: "Canon DSLR Camera",
      description:
        "Purchased on 1st feb 2023.\r\n" +
        "To be used for product photography in the office.",
      mainImage: null,
      mainImageExpiration: null,
      createdAt: "2023-06-20T08:57:17.848Z",
      updatedAt: "2023-06-20T11:08:10.436Z",
      userId: "56cfecc4-61ed-441a-972c-e4511b1fc7b4",
      categoryId: "clj40mjnl0000g7b09dkqjs31",
      locationId: null,
      category: {
        id: "clj40mjnl0000g7b09dkqjsg34",
        name: "Cameras",
        description:
          "Items that are used for office work, such as computers, printers, scanners, phones, etc.",
        color: "#175CD3",
        createdAt: "2023-06-20T08:20:27.009Z",
        updatedAt: "2023-06-20T08:20:27.009Z",
        userId: "56cfecc4-61ed-441a-972c-e4511b1fc7b4",
      },
      tags: [
        {
          createdAt: "2023-06-20T08:21:56.111Z",
          description: "",
          id: "clj40ogfk000sg7b02fudkef6f",
          name: "Tech",
          updatedAt: "2023-06-20T08:21:56.111Z",
          userId: "56cfecc4-61ed-441a-972c-e4511b1fc7b4",
        },
      ],
    },
    {
      id: "clj41xxks000ug7b074y0wdefv",
      title: "LED screen",
      description:
        "Purchased on 1st feb 2023.\r\n" +
        "To be used for product photography in the office.",
      mainImage: null,
      mainImageExpiration: null,
      createdAt: "2023-06-20T08:57:17.848Z",
      updatedAt: "2023-06-20T11:08:10.436Z",
      userId: "56cfecc4-61ed-441a-972c-e4511b1fc7b4",
      categoryId: "clj40mjnl0000g7b09dkqjswe1",
      locationId: null,
      category: {
        id: "clj40mjnl0000g7b09dkqjswe",
        name: "Office Equipment",
        description:
          "Items that are used for office work, such as computers, printers, scanners, phones, etc.",
        color: "#ab339f",
        createdAt: "2023-06-20T08:20:27.009Z",
        updatedAt: "2023-06-20T08:20:27.009Z",
        userId: "56cfecc4-61ed-441a-972c-e4511b1fc7b4",
      },
      tags: [
        {
          createdAt: "2023-06-20T08:21:56.111Z",
          description: "",
          id: "clj40ogfk000sg7b02fudkef6f",
          name: "Tech",
          updatedAt: "2023-06-20T08:21:56.111Z",
          userId: "56cfecc4-61ed-441a-972c-e4511b1fc7b4",
        },
      ],
    },
  ];
  const page = 1;
  const totalItems = items.length;
  const perPage = 10;
  const next = null;
  const prev = null;
  const totalPages = 1;

  return json({
    location,
    header,
    modelName,
    items,
    page,
    totalItems,
    perPage,
    totalPages,
    next,
    prev,
  });
};

export const meta: V2_MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data?.header?.title) },
];

export const handle = {
  breadcrumb: () => "single",
};

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: mapCss },
  { rel: "stylesheet", href: assetCss },
];

export default function LocationPage() {
  const { location } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  return (
    <div>
      <Header>
        <Button
          to="qr"
          variant="secondary"
          icon="barcode"
          onlyIconOnMobile={true}
        >
          View QR code
        </Button>

        <ActionsDopdown location={location} />
      </Header>
      <div className="mt-8 block lg:flex">
        <div className="shrink-0 overflow-hidden lg:w-[343px] xl:w-[400px]">
          <img
            src="/images/asset-placeholder.jpg"
            className={tw(
              "hidden h-auto w-[343px] rounded-lg border object-cover md:block md:h-[343px] xl:h-auto md:w-full",
              location.description ? "rounded-b-none border-b-0" : ""
            )}
          />
          {location.description ? (
            <Card className="mt-0 md:rounded-t-none mb-4">
              <p className=" text-gray-600">{location.description}</p>
            </Card>
          ) : null}

          <div className="border border-gray-200 px-4 py-5 flex items-center justify-between gap-10 rounded-lg mb-4">
            <span className=" text-xs font-medium text-gray-600">Address</span>
            <span className="font-medium">{location.address}</span>
          </div>

          <div className="mb-10">
            <ShelfMap latitude={48.858093} longitude={2.294694} />
            <div className="p-4 text-text-xs text-gray-600 border text-center border-gray-200">
              <p>
                <Button
                  to={`https://www.google.com/maps/search/?api=1&query=${48.858093},${2.294694}&zoom=15&markers=${48.858093},${2.294694}`}
                  variant="link"
                  target="_blank"
                  rel="nofollow noopener noreferrer"
                >
                  See in Google Maps
                </Button>
              </p>
            </div>
          </div>
        </div>

        <div className="w-full lg:ml-8">
          <List
            ItemComponent={ListAssetContent}
            navigate={(itemId) => navigate(itemId)}
            headerChildren={
              <>
                <th className="hidden border-b p-4 text-left font-normal text-gray-600 md:table-cell md:px-6">
                  Category
                </th>
                <th className="hidden border-b p-4 text-left font-normal text-gray-600 md:table-cell md:px-6">
                  Tags
                </th>
                <th className="hidden border-b p-4 text-left font-normal text-gray-600 md:table-cell md:px-6">
                  Location
                </th>
              </>
            }
          />
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
  };
}) => {
  const { category, tags } = item;
  return (
    <>
      <td className="w-auto lg:w-3/5 max-w-3/5 border-b">
        <div className="flex justify-between gap-3 p-4 md:justify-normal md:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-[4px] border">
              <img
                src="/images/asset-placeholder.jpg"
                className="h-10 w-10 rounded-[4px] object-cover"
              />
            </div>
            <div className="flex flex-row items-center gap-2 md:flex-col md:items-start md:gap-0">
              <div className="font-medium">{item.title}</div>
              <div className="hidden text-gray-600 md:block">{item.id}</div>
              <div className="block md:hidden">
                {category ? (
                  <Badge color={category.color}>{category.name}</Badge>
                ) : null}
              </div>
            </div>
          </div>

          <button className="block md:hidden">
            <ChevronRight />
          </button>
        </div>
      </td>
      <td className="hidden whitespace-nowrap border-b p-4 md:table-cell md:px-6">
        {category ? (
          <Badge color={category.color}>{category.name}</Badge>
        ) : null}
      </td>
      <td className="hidden whitespace-nowrap border-b p-4 text-left md:table-cell md:px-6">
        <ListItemTagsColumn tags={tags} />
      </td>
      <td className="hidden whitespace-nowrap border-b p-4 text-left md:table-cell md:px-6">
        <span className="inline-flex items-center rounded-2xl bg-gray-100 px-2 py-0.5">
          <img
            src="/images/no-location-image.jpg"
            alt="img"
            className="w-4 h-4 rounded-full"
          />
          <span className="ml-1.5 text-[12px] font-medium text-gray-700">
            Gear Room III
          </span>
        </span>
      </td>
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
