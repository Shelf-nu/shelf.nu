import type { LoaderArgs } from "@remix-run/node";

import { json } from "@remix-run/node";
import { Link, NavLink, useLoaderData } from "@remix-run/react";
import Header from "~/components/layout/header";

import { requireAuthSession } from "~/modules/auth";
import { getItems } from "~/modules/item";
import { notFound } from "~/utils";

export async function loader({ request }: LoaderArgs) {
  const { userId, email } = await requireAuthSession(request);

  const items = await getItems({ userId });

  if (!items) {
    throw notFound(`No user with id ${userId}`);
  }

  const title = "All your items";

  return json({ email, items, title });
}

export default function ItemIndexPage() {
  const data = useLoaderData<typeof loader>();
  const hasItems = data.items.length > 0;
  const Actions = () => (
    <Link
      to="new"
      role="link"
      aria-label="new item"
      className="mt-5 text-blue-600"
    >
      + Create new item
    </Link>
  );

  return (
    <div>
      <Header title={data.title} actions={Actions} />
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
