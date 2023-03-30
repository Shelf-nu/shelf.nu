import type { LoaderArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { redirect } from "react-router";
import { Filters, List } from "~/components/list";
import { requireAuthSession } from "~/modules/auth";
import { countTotalItems, getItems } from "~/modules/item";
import { notFound } from "~/utils";

const getParams = (searchParams: URLSearchParams) => ({
  page: Number(searchParams.get("page") || "0"),
  perPage: Number(searchParams.get("per_page") || "8"),
  search: searchParams.get("s") || null,
  intent: searchParams.get("intent") || null,
});

export async function loader({ request }: LoaderArgs) {
  const { userId } = await requireAuthSession(request);

  const { page, perPage, search, intent } = getParams(
    new URL(request.url).searchParams
  );
  const clearSearch = intent === "clearSearch";

  const items = await getItems({ userId, page, perPage, search });
  const totalItems = await countTotalItems(userId);
  const totalPages = Math.ceil(totalItems / perPage);

  if (page > totalPages) {
    return redirect("/items");
  }

  if (!items) {
    throw notFound(`No user with id ${userId}`);
  }

  return json({
    items,
    search,
    clearSearch,
    page,
    totalItems,
    perPage,
    totalPages,
  });
}

export default function ItemIndexPage() {
  return (
    <div className="mt-8 flex flex-1 flex-col gap-2">
      <Filters />
      <List />
    </div>
  );
}
