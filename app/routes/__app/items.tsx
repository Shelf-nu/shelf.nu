import type { LoaderArgs } from "@remix-run/node";
import { Link, Outlet } from "@remix-run/react";

import { requireAuthSession } from "~/modules/auth";

export const handle = {
  breadcrumb: () => <Link to="/items">Items</Link>,
};

export async function loader({ request }: LoaderArgs) {
  await requireAuthSession(request);
  return null;
}

export default function ItemsPage() {
  return (
    <div>
      <Outlet />
    </div>
  );
}
