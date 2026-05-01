/**
 * Reports Layout Route
 *
 * Parent layout for all report routes. Provides breadcrumb navigation.
 *
 * @see {@link file://./reports._index.tsx}
 * @see {@link file://./reports.$reportId.tsx}
 */

import { Link, Outlet, type MetaFunction } from "react-router";
import { ErrorContent } from "~/components/errors";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export const meta: MetaFunction = () => [
  { title: appendToMetaTitle("Reports") },
];

export const handle = {
  breadcrumb: () => <Link to="/reports">Reports</Link>,
};

export default function ReportsLayout() {
  return <Outlet />;
}

export const ErrorBoundary = () => <ErrorContent />;
