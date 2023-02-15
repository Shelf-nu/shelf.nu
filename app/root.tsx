import type {
  LinksFunction,
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

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: globalStylesheetUrl },
  { rel: "stylesheet", href: tailwindStylesheetUrl },
];

export const meta: MetaFunction = () => ({
  charset: "utf-8",
  title: "shelf.nu",
  viewport: "width=device-width,initial-scale=1",
});

export const loader: LoaderFunction = async () => {
  return json({
    env: getBrowserEnv(),
  });
};

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
