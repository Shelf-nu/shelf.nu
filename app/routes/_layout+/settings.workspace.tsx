import { Link, Outlet } from "@remix-run/react";
import { ErrorBoundryComponent } from "~/components/errors";

export async function loader() {
  return null;
}

export const handle = {
  breadcrumb: () => <Link to="/settings/workspace">Workspaces</Link>,
};

export default function WorkspacesIndex() {
  return <Outlet />;
}

export const ErrorBoundary = () => <ErrorBoundryComponent />;
