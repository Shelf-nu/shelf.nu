import type { User } from "@prisma/client";
import { cssBundleHref } from "@remix-run/css-bundle";
import type {
  LinksFunction,
  LoaderFunction,
  MetaFunction,
} from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  Link,
  Links,
  LiveReload,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from "@remix-run/react";

import { HomeIcon } from "./components/icons/library";
import fontsStylesheetUrl from "./styles/fonts.css";
import globalStylesheetUrl from "./styles/global.css";
import tailwindStylesheetUrl from "./styles/tailwind.css";
import { getBrowserEnv } from "./utils/env";

export interface RootData {
  env: typeof getBrowserEnv;
  user: User;
}

export const handle = {
  breadcrumb: () => (
    <Link to="/">
      <HomeIcon className="inline" />
    </Link>
  ),
};

export const links: LinksFunction = () => {
  const alwaysPresentStyles = [
    { rel: "stylesheet", href: tailwindStylesheetUrl },
    { rel: "stylesheet", href: fontsStylesheetUrl },
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

export const loader: LoaderFunction = async () =>
  json({
    env: getBrowserEnv(),
  });

export default function App() {
  const { env } = useLoaderData<typeof loader>();

  return (
    <html lang="en" className="h-full">
      <head>
        <Meta />
        <Links />
      </head>
      <body className="h-full">
        <Outlet />
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
