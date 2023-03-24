import type {
  LinksFunction,
  LoaderArgs,
  LoaderFunction,
} from "@remix-run/node";
import { json } from "@remix-run/node";
import { Outlet, useLoaderData } from "@remix-run/react";

import Header from "~/components/layout/header";
import Sidebar from "~/components/layout/sidebar";
import { requireAuthSession } from "~/modules/auth";
import { getUserByEmail } from "~/modules/user";
import styles from "~/styles/layout.css";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: styles }];

export const loader: LoaderFunction = async ({ request }: LoaderArgs) => {
  const authSession = await requireAuthSession(request);

  const user = authSession
    ? await getUserByEmail(authSession?.email)
    : undefined;

  return json({
    user,
  });
};

export default function App() {
  const { user } = useLoaderData<typeof loader>();

  return (
    <div className="flex h-full min-h-screen flex-col ">
      <main className="flex h-full ">
        <div className="h-full w-80 border-r border-gray-200 p-8">
          <Sidebar user={user} />
        </div>

        <div className="h-full w-full bg-gray-25 py-3">
          <div className="flex h-full flex-1 flex-col p-8">
            <Header />
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}
