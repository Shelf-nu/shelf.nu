import type {
  LinksFunction,
  LoaderArgs,
  LoaderFunction,
  MetaFunction,
} from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  Links,
  LiveReload,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from "@remix-run/react";

import globalStylesheetUrl from "./styles/global.css";
import tailwindStylesheetUrl from "./styles/tailwind.css";
import { getBrowserEnv } from "./utils/env";
import Header from "./components/layout/header";
import Sidebar from "./components/layout/sidebar";
import { requireAuthSession } from "./modules/auth";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: globalStylesheetUrl },
  { rel: "stylesheet", href: tailwindStylesheetUrl },
];

export const meta: MetaFunction = () => ({
  charset: "utf-8",
  title: "shelf.nu",
  viewport: "width=device-width,initial-scale=1",
});

export const loader: LoaderFunction = async ({ request }: LoaderArgs) => {
  const { userId, email } = await requireAuthSession(request);
  return json({
    env: getBrowserEnv(),
    user: {
      userId,
      email,
    },
  });
};

export default function App() {
  const { env, user } = useLoaderData<typeof loader>();
  console.log(user);
  return (
    <html lang="en" className="h-full">
      <head>
        <Meta />
        <Links />
      </head>
      <body className="h-full">
        <div className="flex h-full min-h-screen flex-col">
          <Header
          // email={data.email}
          />

          <main className="flex h-full bg-white">
            <div className="h-full w-80 border-r bg-gray-50">
              <Sidebar />
            </div>

            <div className="flex-1 p-6">
              <Outlet />
            </div>
          </main>
        </div>
        <ScrollRestoration />
        <script
          dangerouslySetInnerHTML={{
            __html: `window.env = ${JSON.stringify(env)}`,
          }}
        />
        <Scripts />
        <LiveReload />
      </body>
    </html>
  );
}
