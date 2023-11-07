import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet } from "@remix-run/react";
import { ErrorBoundryComponent } from "~/components/errors";

import { commitAuthSession, requireAuthSession } from "~/modules/auth";

export async function loader({ request }: LoaderFunctionArgs) {
  const authSession = await requireAuthSession(request);

  return json(
    {},
    {
      headers: [
        [
          "Set-Cookie",
          await commitAuthSession(request, {
            authSession,
          }),
        ],
      ],
    }
  );
}

export const handle = {
  breadcrumb: () => <Link to="/assets">Assets</Link>,
};

export default function AssetsPage() {
  return <Outlet />;
}

export const ErrorBoundary = () => <ErrorBoundryComponent />;
