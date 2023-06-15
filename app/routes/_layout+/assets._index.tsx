import type { Category, Asset, Tag } from "@prisma/client";
import type { LoaderArgs, V2_MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useNavigate } from "@remix-run/react";
import { redirect } from "react-router";
import { AssetImage } from "~/components/assets/asset-image";
import { ChevronRight } from "~/components/icons";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { Filters, List } from "~/components/list";
import { CategoryFilters } from "~/components/list/filters/category";
import { TagFilters } from "~/components/list/filters/tag";
import type { ListItemData } from "~/components/list/list-item";
import { Badge } from "~/components/shared/badge";
import { Button } from "~/components/shared/button";
import { Tag as TagBadge } from "~/components/shared/tag";
import { getAssets } from "~/modules/asset";
import { requireAuthSession } from "~/modules/auth";
import { getAllCategories } from "~/modules/category";
import { getAllTags } from "~/modules/tag";
import { getUserByID } from "~/modules/user";
import {
  generatePageMeta,
  getCurrentSearchParams,
  getParamsValues,
  notFound,
} from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export interface IndexResponse {
  /** Page number. Starts at 1 */
  page: number;

  /** Items to be loaded per page */
  perPage: number;

  /** Items to be rendered in the list */
  items: ListItemData[];

  categoriesIds?: string[];

  /** Total items - before filtering */
  totalItems: number;

  /** Total pages */
  totalPages: number;

  /** Search string */
  search: string | null;

  /** Next page url - used for pagination */
  next: string;

  /** Prev page url - used for pagination */
  prev: string;

  /** Used so all the default actions can be generate such as empty state, creating and so on */
  modelName: {
    singular: string;
    plural: string;
  };
}

export async function loader({ request }: LoaderArgs) {
  const { userId } = await requireAuthSession(request);
  const user = await getUserByID(userId);

  if (!user) {
    return redirect("/login");
  }

  const searchParams = getCurrentSearchParams(request);
  const { page, perPage, search, categoriesIds, tagsIds } =
    getParamsValues(searchParams);
  const { prev, next } = generatePageMeta(request);

  const categories = await getAllCategories({
    userId,
  });

  const tags = await getAllTags({
    userId,
  });

  const { assets, totalAssets } = await getAssets({
    userId,
    page,
    perPage,
    search,
    categoriesIds,
    tagsIds,
  });
  const totalPages = Math.ceil(totalAssets / perPage);

  if (page > totalPages) {
    return redirect("/assets");
  }

  if (!assets) {
    throw notFound(`No user with id ${userId}`);
  }

  const header: HeaderData = {
    title: user?.firstName ? `${user.firstName}'s stash` : `Your stash`,
  };

  const modelName = {
    singular: "asset",
    plural: "assets",
  };

  return json({
    header,
    items: assets,
    categories,
    tags,
    search,
    page,
    totalItems: totalAssets,
    perPage,
    totalPages,
    next,
    prev,
    modelName,
  });
}

export const meta: V2_MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data.header.title) },
];

export default function AssetIndexPage() {
  const navigate = useNavigate();
  return (
    <>
      <Header>
        <Button
          to="new"
          role="link"
          aria-label={`new asset`}
          icon="plus"
          data-test-id="createNewAsset"
        >
          New Asset
        </Button>
      </Header>
      <div className="mt-8 flex flex-1 flex-col md:mx-0 md:gap-2">
        <Filters>
          <div className="flex justify-end gap-8">
            <CategoryFilters />
            <TagFilters />
          </div>
        </Filters>
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
            </>
          }
        />
      </div>
    </>
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
      <td className="w-full  border-b">
        <div className="flex gap-3 p-4 md:px-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-[4px] border">
            <AssetImage
              asset={{
                assetId: item.id,
                mainImage: item.mainImage,
                mainImageExpiration: item.mainImageExpiration,
                alt: item.title,
              }}
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
      </td>
      <td className="hidden border-b p-4 md:table-cell md:px-6">
        {category ? (
          <Badge color={category.color}>{category.name}</Badge>
        ) : null}
      </td>
      <td className="hidden whitespace-nowrap border-b p-4 text-left md:table-cell md:px-6">
        <ListItemTagsColumn tags={tags} />
      </td>
      <td className="md:hidden">
        <button className="block">
          <ChevronRight />
        </button>
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
