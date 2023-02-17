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

import LoggedInLayout from "./components/layout/logged-in";
import { getAuthSession } from "./modules/auth";
import globalStylesheetUrl from "./styles/global.css";
import tailwindStylesheetUrl from "./styles/tailwind.css";
import { getBrowserEnv } from "./utils/env";

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
  const authSession = await getAuthSession(request);

  return json({
    env: getBrowserEnv(),
    authSession,
  });
};

export default function App() {
  const { env, authSession } = useLoaderData<typeof loader>();

  return (
    <html lang="en" className="h-full">
      <head>
        <Meta />
        <Links />
      </head>
      <body className="h-full">
        {/* If there is a session, we show the logged in layout,
         * No session, we render the outlet which will show the index which has the login form.
         * This is kinda scuffed but at this moment I am not sure how else to make the layouts work
         */}
        {authSession ? (
          <LoggedInLayout email={authSession.email} />
        ) : (
          <Outlet />
        )}
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
