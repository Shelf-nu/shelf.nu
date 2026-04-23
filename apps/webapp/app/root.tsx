import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";
import type { User } from "@prisma/client";
import nProgressStyles from "nprogress/nprogress.css?url";
import type {
  LinksFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
  useRouteLoaderData,
} from "react-router";
import { ErrorContent } from "./components/errors";
import BlockInteractions from "./components/layout/maintenance-mode";
import { SidebarTrigger } from "./components/layout/sidebar/sidebar";
import { Clarity } from "./components/marketing/clarity";
import { CloudflareWebAnalytics } from "./components/marketing/cloudflare-web-analytics";
import { AnimationProvider } from "./components/shared/animation-provider";
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
  { rel: "manifest", href: "/static/manifest.json" },
  { rel: "apple-touch-icon", href: config.faviconPath },
  { rel: "icon", href: config.faviconPath },
  ...splashScreenLinks,
  { rel: "stylesheet", href: styles },
  { rel: "stylesheet", href: fontsStylesheetUrl },
  { rel: "stylesheet", href: globalStylesheetUrl },
  { rel: "stylesheet", href: pmDocStylesheetUrl },
  { rel: "stylesheet", href: nProgressStyles },
  { rel: "stylesheet", href: nProgressCustomStyles },
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

/**
 * Subscribe/snapshot helpers for reading `navigator.cookieEnabled` via
 * `useSyncExternalStore`. `navigator.cookieEnabled` is a static boolean per
 * session — no actual change event exists — so `subscribe` is a no-op. Using
 * `useSyncExternalStore` (instead of `useEffect` + `useState`) lets us read the
 * browser value consistently without a flash-of-wrong-content on hydration.
 */
const subscribeCookieEnabled = () => () => {};
const getCookieEnabledSnapshot = () => navigator.cookieEnabled;
// On the server we optimistically assume cookies are enabled so children render;
// `suppressHydrationWarning` on the <body> absorbs any client-side mismatch.
const getCookieEnabledServerSnapshot = () => true;

export function Layout({ children }: { children: ReactNode }) {
  const data = useRouteLoaderData<typeof loader>("root");
  const nonce = useNonce();
  const hasCookies = useSyncExternalStore(
    subscribeCookieEnabled,
    getCookieEnabledSnapshot,
    getCookieEnabledServerSnapshot
  );

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
      <body suppressHydrationWarning>
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
        {/* why: SSR env injection must execute in the browser; React's `<script>{text}</script>` does not run. */}
        <script
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html: `window.env = ${JSON.stringify(data?.env)}`,
          }}
        />
        <CloudflareWebAnalytics />
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
      <AnimationProvider>
        <Outlet />
      </AnimationProvider>
    </PwaManagerProvider>
  );
}

export default App;

export const ErrorBoundary = () => <ErrorContent />;
