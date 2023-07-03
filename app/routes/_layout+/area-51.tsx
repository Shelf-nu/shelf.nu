import type { LoaderArgs } from "@remix-run/node";
import { Link, Outlet } from "@remix-run/react";
import { ErrorBoundryComponent } from "~/components/errors";

import { requireAuthSession } from "~/modules/auth";

export async function loader({ request }: LoaderArgs) {
  await requireAuthSession(request);

  return null;
}

export const handle = {
  breadcrumb: () => <Link to="/area-51">Area 51</Link>,
};

export default function Area51Page() {
  return <Outlet />;
}

export const ErrorBoundary = () => <ErrorBoundryComponent />;
