import type { LoaderArgs } from "@remix-run/node";
import { Link, Outlet } from "@remix-run/react";

import { requireAuthSession } from "~/modules/auth";

export async function loader({ request }: LoaderArgs) {
  await requireAuthSession(request);

  return null;
}

export const handle = {
  breadcrumb: () => <Link to="/items">Items</Link>,
};

export const shouldRevalidate = () => false;

export default function ItemsPage() {
  return <Outlet />;
}
