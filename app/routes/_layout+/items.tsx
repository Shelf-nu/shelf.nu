import type { LoaderArgs, V2_MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Link, Outlet } from "@remix-run/react";
import type { HeaderData } from "~/components/layout/header/types";

import { requireAuthSession } from "~/modules/auth";
import { getUserByID } from "~/modules/user";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export const handle = {
  breadcrumb: () => <Link to="/items">Items</Link>,
};

export async function loader({ request }: LoaderArgs) {
  const { userId } = await requireAuthSession(request);
  const user = await getUserByID(userId);

  /* Just in case */
  if (!user) return redirect("/login");

  const header: HeaderData = {
    title: user.firstName ? `${user.firstName}'s stash` : `Your stash`,
    actions: [
      {
        component: "Button",
        props: {
          to: "items/new",
          role: "link",
          "aria-label": "new item",
          "data-test-id": "createNewItem",
          icon: "plus",
        },
        children: "New item",
      },
    ],
  };
  return json({ header });
}

export const meta: V2_MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data.header.title) },
];

export default function ItemsPage() {
  return (
    <div>
      <Outlet />
    </div>
  );
}
