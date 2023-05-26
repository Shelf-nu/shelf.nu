import type { Category, Asset } from "@prisma/client";
import type { LoaderArgs, V2_MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link } from "@remix-run/react";
import { redirect } from "react-router";
import { AssetImage } from "~/components/assets/asset-image";
import { ChevronRight } from "~/components/icons";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { Filters, List } from "~/components/list";
import { CategoryCheckboxDropdown } from "~/components/list/filters/category-checkbox-dropdown";
import type { ListItemData } from "~/components/list/list-item";
import { Badge } from "~/components/shared/badge";
import { Button } from "~/components/shared/button";
import { getAssets } from "~/modules/asset";
import { requireAuthSession } from "~/modules/auth";
import { getCategories } from "~/modules/category";
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

  console.log("userId", userId);
  console.log("user", user);

  if (!user) {
    return redirect("/login");
  }

  const searchParams = getCurrentSearchParams(request);
  const { page, perPage, search, categoriesIds } =
    getParamsValues(searchParams);
  const { prev, next } = generatePageMeta(request);

  const { categories } = await getCategories({
    userId,
    perPage: 100,
  });

  const { assets, totalAssets } = await getAssets({
    userId,
    page,
    perPage,
    search,
    categoriesIds,
  });

  console.log("categories", categories);
  console.log("assets", assets);
  console.log("totalAssets", totalAssets);

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
          <CategoryCheckboxDropdown />
        </Filters>
        <List ItemComponent={ListAssetContent} />
      </div>
    </>
  );
}

const ListAssetContent = ({
  item,
}: {
  item: Asset & {
    category?: Category;
  };
}) => {
  const category = item?.category;
  return (
    <>
      <Link className={`block `} to={item.id}>
        <article className="flex gap-3">
          <div className="flex w-full items-center justify-between gap-3">
            <div className="flex gap-3">
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
            <div className="hidden md:block">
              {category ? (
                <Badge color={category.color}>{category.name}</Badge>
              ) : null}
            </div>
            <button className="block md:hidden">
              <ChevronRight />
            </button>
          </div>
        </article>
      </Link>
    </>
  );
};
