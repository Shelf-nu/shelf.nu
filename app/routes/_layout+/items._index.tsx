import type { LoaderArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { redirect } from "react-router";
import { List } from "~/components/list";
import { requireAuthSession } from "~/modules/auth";
import { countTotalItems, getItems } from "~/modules/item";
import { notFound } from "~/utils";

const getPage = (searchParams: URLSearchParams) => ({
  page: Number(searchParams.get("page") || "0"),
  perPage: Number(searchParams.get("per_page") || "8"),
});

export async function loader({ request }: LoaderArgs) {
  const { userId, email } = await requireAuthSession(request);
  const { page, perPage } = getPage(new URL(request.url).searchParams);

  const items = await getItems({ userId, page, perPage });
  const totalItems = await countTotalItems(userId);
  const totalPages = Math.ceil(totalItems / perPage);

  if (page > totalPages) {
    return redirect("/items");
  }

  if (!items) {
    throw notFound(`No user with id ${userId}`);
  }

  return json({
    email,
    items,
    page,
    totalItems,
    perPage,
    totalPages,
  });
}

export default function ItemIndexPage() {
  return (
    <div className="mt-8 flex-1 ">
      <List />
    </div>
  );
}
