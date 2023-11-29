import type { PropsWithChildren } from "react";
import type { User } from "@prisma/client";
import type {
  LinksFunction,
  LoaderFunctionArgs,
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

import { ErrorBoundryComponent } from "./components/errors";

import { HomeIcon } from "./components/icons/library";
import MaintenanceMode from "./components/layout/maintenance-mode";
import { Clarity } from "./components/marketing/clarity";
import fontsStylesheetUrl from "./styles/fonts.css";
import globalStylesheetUrl from "./styles/global.css";
import styles from "./tailwind.css";
import { ClientHintCheck, getHints } from "./utils/client-hints";
import { getBrowserEnv } from "./utils/env";
import { useNonce } from "./utils/nonce-provider";
import { splashScreenLinks } from "./utils/splash-screen-links";
export interface RootData {
  env: typeof getBrowserEnv;
  user: User;
}

export const handle = {
  breadcrumb: () => (
    <Link to="/" title="Home">
      <HomeIcon className="inline" />
    </Link>
  ),
};

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: styles },
  { rel: "stylesheet", href: fontsStylesheetUrl },
  { rel: "stylesheet", href: globalStylesheetUrl },
  { rel: "manifest", href: "/manifest.json" },
  ...splashScreenLinks,
];

export const meta: MetaFunction = () => [
  {
    title: "shelf.nu",
  },
];

export const loader = async ({ request }: LoaderFunctionArgs) =>
  json({
    env: getBrowserEnv(),
    maintenanceMode: false,
    requestInfo: {
      hints: getHints(request),
    },
  });

export const shouldRevalidate = () => false;

function Document({ children, title }: PropsWithChildren<{ title?: string }>) {
  const { env } = useLoaderData<typeof loader>();
  const nonce = useNonce();
  return (
    <html lang="en" className="h-full">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <ClientHintCheck nonce={nonce} />

        <Meta />
        {title ? <title>{title}</title> : null}
        <Links />
        <Clarity />
      </head>
      <body className="h-full">
        {children}
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

export default function App() {
  const { maintenanceMode } = useLoaderData<typeof loader>();
  return (
    <Document>{maintenanceMode ? <MaintenanceMode /> : <Outlet />}</Document>
  );
}

export const ErrorBoundary = () => <ErrorBoundryComponent />;
