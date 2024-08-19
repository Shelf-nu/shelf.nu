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
  useRouteLoaderData,
} from "@remix-run/react";
import { withSentry } from "@sentry/remix";
import nProgressStyles from "nprogress/nprogress.css?url";
import { ErrorContent } from "./components/errors";
import { HomeIcon } from "./components/icons/library";
import MaintenanceMode from "./components/layout/maintenance-mode";
import { Clarity } from "./components/marketing/clarity";
import { config } from "./config/shelf.config";
import { useNprogress } from "./hooks/use-nprogress";
import fontsStylesheetUrl from "./styles/fonts.css?url";
import globalStylesheetUrl from "./styles/global.css?url";
import nProgressCustomStyles from "./styles/nprogress.css?url";
import styles from "./tailwind.css?url";
import { ClientHintCheck, getClientHint } from "./utils/client-hints";
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
  { rel: "apple-touch-icon", href: config.faviconPath },
  { rel: "icon", href: config.faviconPath },
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
        hints: getClientHint(request),
      },
    })
  );

export const shouldRevalidate = () => false;

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useRouteLoaderData<typeof loader>("root");
  const nonce = useNonce();
  return (
    <html lang="en" className="h-full">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <ClientHintCheck nonce={nonce} />
        <style data-fullcalendar />
        <Meta />
        <Links />
        <Clarity />
      </head>
      <body className="h-full">
        {children}
        <ScrollRestoration />
        <script
          dangerouslySetInnerHTML={{
            __html: `window.env = ${JSON.stringify(data?.env)}`,
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

  return maintenanceMode ? <MaintenanceMode /> : <Outlet />;
}

export default withSentry(App);

export const ErrorBoundary = () => <ErrorContent />;
