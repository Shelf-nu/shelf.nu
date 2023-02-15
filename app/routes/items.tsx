import type { LoaderArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, Outlet, Link, NavLink } from "@remix-run/react";

import { LogoutButton, requireAuthSession } from "~/modules/auth";
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

  return (
    <div className="flex h-full min-h-screen flex-col">
      <header className="flex items-center justify-between bg-slate-800 p-4 text-white">
        <h1 className="text-3xl font-bold">
          <Link to=".">shelf.nu 🏺</Link>
        </h1>
        <p>{data.email}</p>
        <LogoutButton />
      </header>

      <main className="flex h-full bg-white">
        <div className="h-full w-80 border-r bg-gray-50">
          <Link to="new" className="block p-4 text-xl text-blue-500">
            + New Item
          </Link>

          <hr />

          {data.items.length === 0 ? (
            <p className="p-4">No items yet</p>
          ) : (
            <ol>
              {data.items.map((item) => (
                <li key={item.id}>
                  <NavLink
                    className={({ isActive }) =>
                      `block border-b p-4 text-xl ${isActive ? "bg-white" : ""}`
                    }
                    to={item.id}
                  >
                    📝 {item.title}
                  </NavLink>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="flex-1 p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
