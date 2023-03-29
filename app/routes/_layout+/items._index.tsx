import type { LoaderArgs } from "@remix-run/node";

import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { Button } from "~/components/shared/button";

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

  if (!items) {
    throw notFound(`No user with id ${userId}`);
  }

  return json({ email, items, page, totalItems, perPage });
}

export default function ItemIndexPage() {
  const { page, items, totalItems, perPage } = useLoaderData<typeof loader>();
  const hasItems = items?.length > 0;

  return (
    <div className="mt-8">
      {!hasItems ? (
        <p className="p-4">No items yet. </p>
      ) : (
        <div className="rounded-[12px] border border-gray-200 bg-white">
          <li className="flex justify-between border-b px-6 py-[14px] text-gray-600">
            {totalItems} items
          </li>
          <ol>
            {items.map((item) => (
              <li
                key={item.id}
                className="border-b last:border-b-0 hover:bg-gray-50 "
              >
                <Link className={`block px-6 py-4`} to={item.id}>
                  <article className="flex gap-3">
                    <img
                      src="/images/placeholder-square.png"
                      className=" h-10 w-10 rounded-[4px] border"
                      alt="item placeholder"
                    />
                    <div className="flex flex-col">
                      <div className="font-medium">{item.title}</div>
                      <div className="text-gray-600">{item.id}</div>
                    </div>
                  </article>
                </Link>
              </li>
            ))}
            <li className="flex justify-between px-6 py-[18px]">
              <Button
                variant="secondary"
                size="sm"
                to={`.?page=${page - 1}`}
                disabled={page <= 1}
              >
                {"< Previous"}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                to={`.?page=${page + 1}`}
                disabled={page * perPage >= totalItems}
              >
                {"Next >"}
              </Button>
            </li>
          </ol>
        </div>
      )}
    </div>
  );
}
