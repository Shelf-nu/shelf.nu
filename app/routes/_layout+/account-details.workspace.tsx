import { Link, Outlet } from "@remix-run/react";
import { ErrorContent } from "~/components/errors";

export const handle = {
  breadcrumb: () => <Link to="/account-details/workspace">Workspaces</Link>,
};

export default function WorkspacesIndex() {
  return <Outlet />;
}

export const ErrorBoundary = () => <ErrorContent />;
