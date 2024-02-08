import { Link, Outlet } from "@remix-run/react";
import { ErrorBoundryComponent } from "~/components/errors";

export async function loader() {
  return null;
}

export const handle = {
  breadcrumb: () => <Link to="/assets">Assets</Link>,
};

export default function AssetsPage() {
  return <Outlet />;
}

export const ErrorBoundary = () => <ErrorBoundryComponent />;
