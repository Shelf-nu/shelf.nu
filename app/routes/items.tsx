import type { LoaderArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, Link, NavLink } from "@remix-run/react";

import ContextualSidebar from "~/components/layout/contextual-sidebar";
import Heading from "~/components/shared/heading";
import { requireAuthSession } from "~/modules/auth";
import { getItems } from "~/modules/item";
import { notFound } from "~/utils/http.server";

export async function loader({ request }: LoaderArgs) {
  const { userId, email } = await requireAuthSession(request);

  const items = await getItems({ userId });

  if (!items) {
    throw notFound(`No user with id ${userId}`);
  }

  return json({ email, items });
}

export default function ItemsPage() {
  const data = useLoaderData<typeof loader>();
  const hasItems = data.items.length > 0;

  return (
    <div className="flex h-full min-h-screen flex-col px-16 py-20">
      <div className="flex justify-between">
        <div>
          <Heading className="mr-2 inline-block">All your items</Heading>
          <span className="opacity-50">{data.items.length} items</span>
        </div>
        <div className="mt-5 text-blue-600">
          <Link to="new" role="link" aria-label="new item">
            + Create new item
          </Link>
        </div>
      </div>
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
      <ContextualSidebar />
    </div>
  );
}
