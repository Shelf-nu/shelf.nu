import type { LoaderArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Link, Outlet } from "@remix-run/react";

import { requireAuthSession } from "~/modules/auth";
import { getUserByEmail } from "~/modules/user";

export const handle = {
  breadcrumb: () => <Link to="/items">Items</Link>,
};

export async function loader({ request }: LoaderArgs) {
  const authSession = await requireAuthSession(request);
  const user = authSession
    ? await getUserByEmail(authSession?.email)
    : undefined;

  /* Just in case */
  if (!user) return redirect("/login");

  const header = {
    title: `${user.firstName}'s stash`,
    actions: [
      {
        props: {
          to: "items/new",
          className: "text-blue-500 underline",
          role: "link",
          "aria-label": "new item",
          "data-test-id": "createNewItem",
        },
        children: "+ Create new item",
      },
    ],
  };
  return json({ header });
}

export default function ItemsPage() {
  return (
    <div>
      <Outlet />
    </div>
  );
}
