import { useEffect, useState } from "react";
import type { User } from "@prisma/client";
import type { LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
  useRouteLoaderData,
} from "react-router";
import { withSentry } from "@sentry/remix";
import nProgressStyles from "nprogress/nprogress.css?url";
import { ErrorContent } from "./components/errors";
import BlockInteractions from "./components/layout/maintenance-mode";
import { SidebarTrigger } from "./components/layout/sidebar/sidebar";
import { Clarity } from "./components/marketing/clarity";
import { config } from "./config/shelf.config";
import { useNprogress } from "./hooks/use-nprogress";
import fontsStylesheetUrl from "./styles/fonts.css?url";
import globalStylesheetUrl from "./styles/global.css?url";
import nProgressCustomStyles from "./styles/nprogress.css?url";
import pmDocStylesheetUrl from "./styles/pm-doc.css?url";
import styles from "./tailwind.css?url";
import { ClientHintCheck, getClientHint } from "./utils/client-hints";
import { getBrowserEnv } from "./utils/env";
import { payload } from "./utils/http.server";
import { useNonce } from "./utils/nonce-provider";
import { PwaManagerProvider } from "./utils/pwa-manager";
import { splashScreenLinks } from "./utils/splash-screen-links";

export interface RootData {
  env: typeof getBrowserEnv;
  user: User;
}

export const handle = {
  breadcrumb: () => <SidebarTrigger />,
};

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: styles },
  { rel: "stylesheet", href: fontsStylesheetUrl },
  { rel: "stylesheet", href: globalStylesheetUrl },
  { rel: "stylesheet", href: pmDocStylesheetUrl },
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
  payload({
    env: getBrowserEnv(),
    maintenanceMode: false,
    requestInfo: {
      hints: getClientHint(request),
    },
  });

export const shouldRevalidate = () => false;

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useRouteLoaderData<typeof loader>("root");
  const nonce = useNonce();
  const [hasCookies, setHasCookies] = useState(true);

  useEffect(() => {
    setHasCookies(navigator.cookieEnabled);
  }, []);

  return (
    <html lang="en" className="overflow-hidden">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <ClientHintCheck nonce={nonce} />
        <style data-fullcalendar />
        <Meta />
        <Links />
        <Clarity />
      </head>
      <body>
        <noscript>
          <BlockInteractions
            title="JavaScript is disabled"
            content="This website requires JavaScript to be enabled to function properly. Please enable JavaScript or change browser and try again."
            icon="x"
          />
        </noscript>

        {hasCookies ? (
          children
        ) : (
          <BlockInteractions
            title="Cookies are disabled"
            content="This website requires cookies to be enabled to function properly. Please enable cookies and try again."
            icon="x"
          />
        )}

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

  return maintenanceMode ? (
    <BlockInteractions
      title={"Maintenance is being performed"}
      content={
        "Apologies, we’re down for scheduled maintenance. Please try again later."
      }
      cta={{
        to: "https://www.shelf.nu/blog-categories/updates-maintenance",
        text: "Learn more",
      }}
      icon="tool"
    />
  ) : (
    <PwaManagerProvider>
      <Outlet />
    </PwaManagerProvider>
  );
}

export default withSentry(App);

export const ErrorBoundary = () => <ErrorContent />;
