import type { LoaderArgs, V2_MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { redirect } from "react-router";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { Filters, List } from "~/components/list";
import type { ListItemData } from "~/components/list/list-item";
import { Button } from "~/components/shared/button";
import { requireAuthSession } from "~/modules/auth";
import { getItems } from "~/modules/item";
import { getUserByID } from "~/modules/user";
import { getCurrentSearchParams, mergeSearchParams, notFound } from "~/utils";
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
}

const getParamsValues = (searchParams: URLSearchParams) => ({
  page: Number(searchParams.get("page") || "0"),
  perPage: Number(searchParams.get("per_page") || "8"),
  search: searchParams.get("s") || null,
});

export async function loader({ request }: LoaderArgs) {
  const { userId } = await requireAuthSession(request);
  const user = await getUserByID(userId);

  if (!user) {
    return redirect("/login");
  }

  const searchParams = getCurrentSearchParams(request);
  const { page, perPage, search } = getParamsValues(searchParams);

  let prev = search
    ? mergeSearchParams(searchParams, { page: page - 1 })
    : `?page=${page - 1}`;

  let next = search
    ? mergeSearchParams(searchParams, { page: page >= 1 ? page + 1 : 2 })
    : `?page=${page >= 1 ? page + 1 : 2}`;

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
          aria-label="new item"
          icon="plus"
          data-test-id="createNewItem"
        >
          New Item
        </Button>
      </Header>
      <div className="mt-8 flex flex-1 flex-col gap-2">
        <Filters />
        <List />
      </div>
    </>
  );
}
