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
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from "@remix-run/react";
import { withSentry } from "@sentry/remix";
import nProgressStyles from "nprogress/nprogress.css?url";
import { ErrorContent } from "./components/errors";
import { HomeIcon } from "./components/icons/library";
import MaintenanceMode from "./components/layout/maintenance-mode";
import { Clarity } from "./components/marketing/clarity";
import { useNprogress } from "./hooks/use-nprogress";
import fontsStylesheetUrl from "./styles/fonts.css?url";
import globalStylesheetUrl from "./styles/global.css?url";
import nProgressCustomStyles from "./styles/nprogress.css?url";
import styles from "./tailwind.css?url";
import { ClientHintCheck, getHints } from "./utils/client-hints";
import { getBrowserEnv } from "./utils/env";
import { data } from "./utils/http.server";
import { useNonce } from "./utils/nonce-provider";
import { splashScreenLinks } from "./utils/splash-screen-links";

export interface RootData {
  env: typeof getBrowserEnv;
  user: User;
}

export const handle = {
  breadcrumb: () => (
    <Link to="/" title="Home" id="homeCrumb">
      <HomeIcon className="inline" />
    </Link>
  ),
};

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: styles },
  { rel: "stylesheet", href: fontsStylesheetUrl },
  { rel: "stylesheet", href: globalStylesheetUrl },
  { rel: "manifest", href: "/static/manifest.json" },
  { rel: "apple-touch-icon", href: "/static/favicon.ico" },
  { rel: "icon", href: "/static/favicon.ico" },
  { rel: "stylesheet", href: nProgressStyles },
  { rel: "stylesheet", href: nProgressCustomStyles },
  ...splashScreenLinks,
];

export const meta: MetaFunction = () => [
  {
    title: "shelf.nu",
  },
];

export const loader = ({ request }: LoaderFunctionArgs) =>
  json(
    data({
      env: getBrowserEnv(),
      maintenanceMode: false,
      requestInfo: {
        hints: getHints(request),
      },
    })
  );

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
        <style data-fullcalendar />
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
      </body>
    </html>
  );
}

function App() {
  useNprogress();
  const { maintenanceMode } = useLoaderData<typeof loader>();

  return (
    <Document>{maintenanceMode ? <MaintenanceMode /> : <Outlet />}</Document>
  );
}

export default withSentry(App);

export const ErrorBoundary = () => <ErrorContent />;
