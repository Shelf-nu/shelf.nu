import type { User } from "@prisma/client";
import { cssBundleHref } from "@remix-run/css-bundle";
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
import { getUserByEmail } from "./modules/user";
import globalStylesheetUrl from "./styles/global.css";
import tailwindStylesheetUrl from "./styles/tailwind.css";
import { getBrowserEnv } from "./utils/env";

export interface RootData {
  env: typeof getBrowserEnv;
  user: User;
}

export const links: LinksFunction = () => {
  const alwaysPresentStyles = [
    { rel: "stylesheet", href: tailwindStylesheetUrl },
    { rel: "stylesheet", href: globalStylesheetUrl },
  ];
  return [
    ...(cssBundleHref
      ? [...alwaysPresentStyles, { rel: "stylesheet", href: cssBundleHref }]
      : [...alwaysPresentStyles]),
  ];
};

export const meta: MetaFunction = () => ({
  charset: "utf-8",
  title: "shelf.nu",
  viewport: "width=device-width,initial-scale=1",
});

export const loader: LoaderFunction = async ({ request }: LoaderArgs) => {
  const authSession = await getAuthSession(request);

  const user = authSession
    ? await getUserByEmail(authSession?.email)
    : undefined;

  return json({
    env: getBrowserEnv(),
    user,
  });
};

export default function App() {
  const { env, user } = useLoaderData<typeof loader>();

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
        {user ? <LoggedInLayout user={user} /> : <Outlet />}
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
