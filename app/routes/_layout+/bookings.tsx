import type { ShouldRevalidateFunctionArgs } from "@remix-run/react";
import { Link, Outlet } from "@remix-run/react";
import { ErrorContent } from "~/components/errors";
import ContextualModal from "~/components/layout/contextual-modal";

export function loader() {
  return null;
}

export function shouldRevalidate({
  actionResult,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  /**
   * If we are toggliong the sidebar, no need to revalidate this loader.
   * Revalidation happens in _layout
   */
  if (actionResult?.isTogglingSidebar) {
    return false;
  }

  return defaultShouldRevalidate;
}

export const handle = {
  breadcrumb: () => <Link to="/bookings">Bookings</Link>,
};

export default function BookingsPage() {
  return (
    <>
      <Outlet />
      <ContextualModal />
    </>
  );
}

export const ErrorBoundary = () => <ErrorContent />;
