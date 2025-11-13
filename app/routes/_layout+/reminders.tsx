import { Link, Outlet } from "react-router";
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
