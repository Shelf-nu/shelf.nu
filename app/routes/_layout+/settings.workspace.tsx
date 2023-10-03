import type { LoaderArgs } from "@remix-run/node";
import { Link, Outlet } from "@remix-run/react";
import { ErrorBoundryComponent } from "~/components/errors";

import { requireAuthSession } from "~/modules/auth";

export async function loader({ request }: LoaderArgs) {
  await requireAuthSession(request);

  return null;
}

export const handle = {
  breadcrumb: () => <Link to="/settings/workspace">Workspaces</Link>,
};

export default function WorkspacesIndex() {
  return <Outlet />;
}

export const ErrorBoundary = () => <ErrorBoundryComponent />;
