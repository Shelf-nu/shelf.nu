import type { LoaderArgs } from "@remix-run/node";

import { json } from "@remix-run/node";
import { Link, NavLink, useLoaderData } from "@remix-run/react";

import { requireAuthSession } from "~/modules/auth";
import { getItems } from "~/modules/item";
import { notFound } from "~/utils";

export async function loader({ request }: LoaderArgs) {
  const { userId, email } = await requireAuthSession(request);

  const items = await getItems({ userId });

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
        <p className="p-4">
          No items yet.{" "}
          <Link
            to="new"
            className="text-blue-500 underline"
            role="link"
            aria-label="new item"
            data-test-id="createNewItem"
          >
            + Create new item
          </Link>
        </p>
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
