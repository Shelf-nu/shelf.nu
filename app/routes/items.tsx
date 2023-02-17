import type { LoaderArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  useLoaderData,
  Outlet,
  Link,
  NavLink,
  useMatches,
} from "@remix-run/react";

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
  const matches = useMatches();
  /** Get the last item which refers to the current route */
  const currentRoute = matches[matches.length - 1];

  const showSidebar = currentRoute?.data?.showSidebar;

  return (
    <div className="flex h-full min-h-screen flex-col">
      {data.items.length === 0 ? (
        <p className="p-4">
          No items yet.{" "}
          <Link
            to="new"
            className="text-blue-500 underline"
            role="link"
            aria-label="new item"
          >
            Create a new item.
          </Link>
        </p>
      ) : (
        <div className="px-4">
          <ol>
            {data.items.map((item) => (
              <li key={item.id}>
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
          <div className="mt-5 text-blue-600">
            <Link to="new" role="link" aria-label="new item">
              Create new item
            </Link>
          </div>
        </div>
      )}
      {showSidebar && (
        <div className="absolute right-0 z-10 flex h-full w-full ">
          <div className="w-1/2 bg-black/60">
            <Link to="/items" className="block h-full w-full">
              {" "}
            </Link>
          </div>
          <div className="w-1/2 bg-white p-6">
            <Outlet />
          </div>
        </div>
      )}
    </div>
  );
}
