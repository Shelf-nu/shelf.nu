import type { ShouldRevalidateFunctionArgs } from "react-router";
import { Link, Outlet } from "react-router";
import { ErrorContent } from "~/components/errors";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { skipRevalidationOnClientViewChange } from "~/utils/list-view-params";

export const meta = () => [{ title: appendToMetaTitle("Bookings") }];

export function loader() {
  return null;
}

export function shouldRevalidate(args: ShouldRevalidateFunctionArgs) {
  /**
   * If we are toggliong the sidebar, no need to revalidate this loader.
   * Revalidation happens in _layout
   */
  if (args.actionResult?.isTogglingSidebar) {
    return false;
  }

  // Skip revalidation for client-view-only navigations (e.g. the booking
  // overview's client-side search/sort/pagination), so they never hit the
  // server through this layout.
  return skipRevalidationOnClientViewChange(args);
}

export const handle = {
  breadcrumb: () => <Link to="/bookings">Bookings</Link>,
};

export default function BookingsPage() {
  return <Outlet />;
}

export const ErrorBoundary = () => <ErrorContent />;
