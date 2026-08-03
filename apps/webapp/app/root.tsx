import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";
import type { User } from "@prisma/client";
import nProgressStyles from "nprogress/nprogress.css?url";
import type {
  LinksFunction,
  LoaderFunctionArgs,
  MetaFunction,
  ShouldRevalidateFunction,
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
import { TooltipProvider } from "./components/shared/tooltip";
import { config } from "./config/shelf.config";
import { db } from "./database/db.server";
import { useNprogress } from "./hooks/use-nprogress";
import { detectAndPersistFormatPrefs } from "./modules/user/format-prefs.server";
import fontsStylesheetUrl from "./styles/fonts.css?url";
import globalStylesheetUrl from "./styles/global.css?url";
import nProgressCustomStyles from "./styles/nprogress.css?url";
import pmDocStylesheetUrl from "./styles/pm-doc.css?url";
import styles from "./tailwind.css?url";
import { ClientHintCheck, getClientHint } from "./utils/client-hints";
import { resolveFormatPrefs } from "./utils/date-format";
import type { ResolvedFormatPrefs } from "./utils/date-format";
import { getBrowserEnv, MAINTENANCE_MODE } from "./utils/env";
import { payload } from "./utils/http.server";
import { useNonce } from "./utils/nonce-provider";
import { isAdmin } from "./utils/roles.server";
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

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  // Super admins bypass maintenance — best-effort. If the admin lookup
  // throws (no session, missing context.getSession, DB error during a
  // migration, etc.), fall through with admin=null so the loader still
  // returns a valid payload. Worst case: admin sees the maintenance
  // screen too. Best case: admin sees the app while users see maintenance.
  const admin = MAINTENANCE_MODE
    ? await isAdmin(context).catch(() => null)
    : null;

  const hints = getClientHint(request);

  // Resolve the acting user's formatting prefs ONCE per request and expose them
  // via requestInfo.formatPrefs — the single seam every date surface reads.
  // Session is optional: context.getSession() throws on auth/onboarding pages
  // (no user), so we tolerate that exactly like the admin lookup above and let
  // browser hints govern (today's behavior). `shouldRevalidate` (below)
  // snapshots this once per full navigation, and additionally re-runs right
  // after the user saves new format prefs so the snapshot never goes stale.
  let formatPrefs: ResolvedFormatPrefs;
  try {
    const { userId } = context.getSession();
    const userPrefs = await db.user.findFirst({
      where: { id: userId },
      select: {
        dateFormat: true,
        timeFormat: true,
        weekStart: true,
        timeZone: true,
      },
    });
    formatPrefs = resolveFormatPrefs(userPrefs, hints);

    // Lazy backfill: pre-existing users have null pref columns. Snapshot the
    // hint-detected values once, fire-and-forget (mirrors recordMobileActivity).
    if (
      userPrefs &&
      (userPrefs.dateFormat === null ||
        userPrefs.timeFormat === null ||
        userPrefs.weekStart === null ||
        userPrefs.timeZone === null)
    ) {
      detectAndPersistFormatPrefs(userId, userPrefs, hints);
    }
  } catch {
    // No session / getSession unavailable / transient DB error → hints govern.
    formatPrefs = resolveFormatPrefs(null, hints);
  }

  return payload({
    env: getBrowserEnv(),
    maintenanceMode: MAINTENANCE_MODE && !admin,
    requestInfo: {
      hints,
      formatPrefs,
    },
  });
};

/**
 * Root loader revalidation gate.
 *
 * The root loader snapshots the acting user's formatting prefs ONCE per full
 * navigation (every date surface reads `requestInfo.formatPrefs` from here), so
 * we normally opt OUT of per-navigation revalidation to avoid re-querying the
 * user on every client transition.
 *
 * The one exception: when the user SAVES new formatting preferences (the
 * `updateFormatPrefs` intent on the account-details.general action), the
 * snapshot would otherwise stay stale app-wide until a hard reload. For that
 * single mutation we opt back IN so the freshly-saved prefs propagate to every
 * date surface immediately.
 *
 * @param args.formData - The submitted form data (present for form
 *   submissions); `undefined` for plain GET navigations.
 * @returns `true` only after the format-prefs save, `false` otherwise.
 */
export const shouldRevalidate: ShouldRevalidateFunction = ({ formData }) =>
  formData?.get("intent") === "updateFormatPrefs";

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
        {/* why: iOS Smart App Banner must be rendered here in <head>, not via a
            route `meta` export. React Router renders the leaf route's meta
            (not a merge of root + leaf), and 150+ routes export their own
            meta, so a root-level descriptor would be dropped on the pages
            users actually visit. Placed in the shared document <head> it is
            present site-wide. Mobile Safari renders a native banner linking to
            the Shelf Companion App Store listing (id6765639874), or "Open" if
            installed. Apple-hosted, zero-maintenance, no CLS, no cookie. */}
        <meta name="apple-itunes-app" content="app-id=6765639874" />
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
          // Single app-level TooltipProvider. Radix recommends wrapping the
          // app once and tolerates nested providers (they merge configs), but
          // hoisting avoids spinning up a provider per-row for high-frequency
          // chips like AssetCodeBadge. delayDuration matches the previous
          // per-chip default so tooltip timing doesn't change.
          <TooltipProvider delayDuration={100}>{children}</TooltipProvider>
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
    <AnimationProvider>
      <Outlet />
    </AnimationProvider>
  );
}

export default App;

export const ErrorBoundary = () => <ErrorContent />;
