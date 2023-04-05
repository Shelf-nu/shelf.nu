import type { Item } from "@prisma/client";
import type { LoaderArgs, V2_MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { redirect } from "react-router";
import { ItemImage } from "~/components/items/item-image";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { Filters, List } from "~/components/list";
import type { ListItemData } from "~/components/list/list-item";
import { Button } from "~/components/shared/button";
import { requireAuthSession } from "~/modules/auth";
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
  const { page, perPage, search } = getParamsValues(searchParams);
  const { prev, next } = generatePageMeta(request);

  const { items, totalItems } = await getItems({
    userId,
    page,
    perPage,
    search,
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
  const { modelName } = useLoaderData<typeof loader>();
  const { singular } = modelName;

  return (
    <>
      <Header>
        <Button
          to="new"
          role="link"
          aria-label={`new ${singular}`}
          icon="plus"
          data-test-id="createNewItem"
        >
          New {singular}
        </Button>
      </Header>
      <div className="mt-8 flex flex-1 flex-col gap-2">
        <Filters />
        <List ItemComponent={ListItemContent} />
      </div>
    </>
  );
}

const ListItemContent = ({ item }: { item: Item }) => (
  <>
    <Link className={`block `} to={item.id}>
      <article className="flex gap-3">
        <div className="flex gap-3">
          <ItemImage
            item={{
              itemId: item.id,
              mainImage: item.mainImage,
              // @ts-ignore
              mainImageExpiration: item.mainImageExpiration,
              alt: item.title,
            }}
            className="h-10 w-10 rounded-[4px] object-cover"
          />

          <div className="flex flex-col">
            <div className="font-medium">{item.title}</div>
            <div className="text-gray-600">{item.id}</div>
          </div>
        </div>
      </article>
    </Link>
  </>
);
