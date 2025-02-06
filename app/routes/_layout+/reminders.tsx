import { Link, Outlet } from "@remix-run/react";
import { ErrorContent } from "~/components/errors";

export function loader() {
  return null;
}

export const handle = {
  breadcrumb: () => <Link to="/reminders">Reminders</Link>,
};

export default function RemindersPage() {
  return <Outlet />;
}

export const ErrorBoundary = () => <ErrorContent />;
