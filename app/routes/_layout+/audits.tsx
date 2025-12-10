import type { ShouldRevalidateFunctionArgs } from "react-router";
import { Link, Outlet } from "react-router";
import { ErrorContent } from "~/components/errors";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export const meta = () => [{ title: appendToMetaTitle("Audits") }];

export function loader() {
  return null;
}

export function shouldRevalidate({
  actionResult,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  /**
   * If we are toggling the sidebar, no need to revalidate this loader.
   * Revalidation happens in _layout
   */
  if (actionResult?.isTogglingSidebar) {
    return false;
  }

  return defaultShouldRevalidate;
}

export const handle = {
  breadcrumb: () => <Link to="/audits">Audits</Link>,
};

export default function AuditsPage() {
  return <Outlet />;
}

export const ErrorBoundary = () => <ErrorContent />;
