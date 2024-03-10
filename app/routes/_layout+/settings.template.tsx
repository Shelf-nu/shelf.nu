import { Link, Outlet } from "@remix-run/react";
import { ErrorBoundryComponent } from "~/components/errors";

export const handle = {
  breadcrumb: () => <Link to="/settings/template">Templates</Link>,
};

export default function TemplatesIndex() {
  return <Outlet />;
}

export const ErrorBoundary = () => <ErrorBoundryComponent />;
