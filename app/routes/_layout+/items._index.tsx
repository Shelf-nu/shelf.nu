import type { LoaderArgs } from "@remix-run/node";

import { json } from "@remix-run/node";
import { NavLink, useLoaderData } from "@remix-run/react";

import { requireAuthSession } from "~/modules/auth";
import { getItems } from "~/modules/item";
import { notFound } from "~/utils";

const getPage = (searchParams: URLSearchParams) => ({
  page: Number(searchParams.get("page") || "0"),
});

export async function loader({ request }: LoaderArgs) {
  const { userId, email } = await requireAuthSession(request);
  const { page } = getPage(new URL(request.url).searchParams);

  const items = await getItems({ userId, page, per_page: 2 });

  if (!items) {
    throw notFound(`No user with id ${userId}`);
  }

  return json({ email, items });
}

export default function ItemIndexPage() {
  const data = useLoaderData<typeof loader>();
  const hasItems = data?.items?.length > 0;

  return (
    <div>
      {!hasItems ? (
        <p className="p-4">No items yet. </p>
      ) : (
        <div className="py-4">
          <ol>
            {data.items.map((item) => (
              <li key={item.id} className="hover:bg-gray-400}">
                <NavLink
                  className={({ isActive }) =>
                    `block border-b py-4 text-xl ${isActive ? "bg-white" : ""}`
                  }
                  to={item.id}
                >
                  📝 {item.title}
                </NavLink>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
