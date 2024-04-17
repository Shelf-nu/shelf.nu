import type { LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, redirect } from "@remix-run/react";

export function loader({ context }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  if (!userId) {
    return redirect("/login");
  }

  return null;
}

export const handle = {
  breadcrumb: () => <Link to="/settings/template">Templates</Link>,
};

export default function TemplatesIndex() {
  return <Outlet />;
}
