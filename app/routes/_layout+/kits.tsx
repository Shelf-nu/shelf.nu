import { Link, Outlet } from "react-router";
import { ErrorContent } from "~/components/errors";

export function loader() {
  return null;
}

export const handle = {
  breadcrumb: () => <Link to="/kits">Kits</Link>,
};

export default function Kits() {
  return <Outlet />;
}

export const ErrorBoundary = () => <ErrorContent />;
