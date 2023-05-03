import type { Category, Item } from "@prisma/client";
import type { LoaderArgs, V2_MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link } from "@remix-run/react";
import { redirect } from "react-router";
import { ChevronRight } from "~/components/icons";
import { ItemImage } from "~/components/items/item-image";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { Filters, List } from "~/components/list";
import { CategoryCheckboxDropdown } from "~/components/list/filters/category-checkbox-dropdown";
import type { ListItemData } from "~/components/list/list-item";
import { Badge } from "~/components/shared/badge";
import { Button } from "~/components/shared/button";
import { requireAuthSession } from "~/modules/auth";
import { getCategories } from "~/modules/category";
import { getItems } from "~/modules/item";
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
  const { page, perPage, search, categoriesIds } =
    getParamsValues(searchParams);
  const { prev, next } = generatePageMeta(request);

  const { categories } = await getCategories({
    userId,
    perPage: 100,
  });

  const { items, totalItems } = await getItems({
    userId,
    page,
    perPage,
    search,
    categoriesIds,
  });
  const totalPages = Math.ceil(totalItems / perPage);

  if (page > totalPages) {
    return redirect("/items");
  }

  if (!items) {
    throw notFound(`No user with id ${userId}`);
  }

  const header: HeaderData = {
    title: user?.firstName ? `${user.firstName}'s stash` : `Your stash`,
  };

  const modelName = {
    singular: "item",
    plural: "items",
  };

  return json({
    header,
    items,
    categories,
    search,
    page,
    totalItems,
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

export default function ItemIndexPage() {
  return (
    <>
      <Header>
        <Button
          to="new"
          role="link"
          aria-label={`new item`}
          icon="plus"
          data-test-id="createNewItem"
        >
          New Item
        </Button>
      </Header>
      <div className="-mx-4 mt-8 flex flex-1 flex-col md:mx-0 md:gap-2">
        <Filters>
          <CategoryCheckboxDropdown />
        </Filters>
        <List ItemComponent={ListItemContent} />
      </div>
    </>
  );
}

const ListItemContent = ({
  item,
}: {
  item: Item & {
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
                <ItemImage
                  item={{
                    itemId: item.id,
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
