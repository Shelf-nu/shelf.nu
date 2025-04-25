import type { ShouldRevalidateFunctionArgs } from "@remix-run/react";
import { Link, Outlet } from "@remix-run/react";
import { ErrorContent } from "~/components/errors";

export function loader() {
  return null;
}

export function shouldRevalidate({
  actionResult,
  formAction,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  /**
   * If we are toggliong the sidebar, no need to revalidate this loader.
   * Revalidation happens in _layout
   */
  if (actionResult?.isTogglingSidebar) {
    return false;
  }

  // Don't revalidate this route if we're just generating thumbnails
  if (formAction?.includes("/api/asset/generate-thumbnail")) {
    return false;
  }

  // Don't revalidate this route if we're just refreshing images
  if (formAction?.includes("/api/asset/refresh-main-image")) {
    return false;
  }

  return defaultShouldRevalidate;
}

export const handle = {
  breadcrumb: () => <Link to="/assets">Assets</Link>,
};

export default function AssetsPage() {
  return <Outlet />;
}

export const ErrorBoundary = () => <ErrorContent />;
