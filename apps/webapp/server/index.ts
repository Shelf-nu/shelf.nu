// import the Sentry instrumentation file before anything else.
// It is important to import it as .js for this to work, even if the file is .ts
import "./instrument.server.js";

import type { Context } from "hono";
import type { AppLoadContext } from "react-router";
import type { HonoServerOptions } from "react-router-hono-server/node";
import { createHonoServer } from "react-router-hono-server/node";
import { getSession, session } from "remix-hono/session";
import { initEnv } from "~/utils/env";
import { ShelfError } from "~/utils/error";
import { runWithTabId } from "~/utils/tab-id.server";

import { logger } from "./logger";
import {
  ensureHostHeaders,
  protect,
  refreshSession,
  urlShortener,
} from "./middleware";
import {
  appLoaderRateLimit,
  calendarFeedRateLimit,
  mobileIpRateLimit,
} from "./rate-limit";
import { runWithRequestCache } from "./request-cache.server";
import { securityHeaders } from "./security-headers";
import { authSessionKey, createSessionStorage } from "./session";
import type { FlashData, SessionData } from "./session";
import { serverTiming } from "./timing.server";

type ServerEnv = {
  Variables: Record<symbol, unknown>;
};

// Server will not start if the env is not valid
initEnv();

export const getLoadContext: HonoServerOptions<ServerEnv>["getLoadContext"] = (
  c,
  { build, mode }
) => {
  const session = getSession<SessionData, FlashData>(c);

  return {
    // Nice to have if you want to display the app version or do something in the app when deploying a new version
    // Exemple: on navigate, check if the app version is the same as the one in the build assets and if not, display a toast to the user to refresh the page
    // Prevent the user to use an old version of the client side code (it is only downloaded on document request)
    appVersion: mode === "production" ? build.assets.version : "dev",
    isAuthenticated: session.has(authSessionKey),
    // we could ensure that session.get() match a specific shape
    // let's trust our system for now
    getSession: () => {
      const auth = session.get(authSessionKey);

      if (!auth) {
        throw new ShelfError({
          cause: null,
          message:
            "There is no session here. This should not happen because if you require it, this route should be mark as protected and catch by the protect middleware.",
          status: 403,
          label: "Dev error",
        });
      }

      return auth;
    },
    setSession: (auth: any) => {
      session.set(authSessionKey, auth);
    },
    destroySession: () => {
      session.unset(authSessionKey);
    },
    errorMessage: session.get("errorMessage") || null,
  } satisfies AppLoadContext;
};

export default createHonoServer<ServerEnv>({
  /** Disable default logger as we have our own */
  defaultLogger: false,
  getLoadContext,
  /**
   * Apply baseline security headers to EVERY response.
   *
   * Registered via `beforeAll` (not `configure`) on purpose: `beforeAll` runs
   * before react-router-hono-server's `serveStatic` handlers, so the
   * `await next()` inside `securityHeaders()` wraps — and therefore decorates —
   * static-asset responses too. Those short-circuit at `serveStatic` and never
   * reach `configure`, so a middleware registered there would miss them.
   */
  beforeAll: (app) => {
    app.use("*", securityHeaders());
  },
  configure: (server) => {
    // Measure total request duration (dev/staging only, skipped in production).
    // Registered first so it captures time spent in all downstream middleware.
    server.use("*", serverTiming());

    /**
     * Ensure host headers are present for React Router CSRF protection
     * Must be early to ensure headers are available for all downstream middleware
     */
    server.use("*", ensureHostHeaders());

    // Attach a per-request AsyncLocalStorage cache for downstream loaders/actions.
    server.use("*", async (_c, next) => runWithRequestCache(() => next()));

    // Store the X-Tab-Id header so sendNotification() can tag toasts per tab.
    server.use("*", async (c, next) =>
      runWithTabId(c.req.header("X-Tab-Id"), () => next())
    );

    // Apply URL shortener middleware only when host matches
    // In v2, we check the host inside middleware instead of using getPath
    server.use("*", async (c, next) => {
      const host = c.req.header("host");

      // If this is the URL shortener host, handle it
      if (process.env.URL_SHORTENER && host === process.env.URL_SHORTENER) {
        return urlShortener({
          excludePaths: ["/file-assets", "/healthcheck", "/static"],
        })(c, next);
      }

      return next();
    });

    /**
     * Add logger middleware
     */
    server.use("*", logger());

    /**
     * Mobile API rate limit. Path-scoped so webapp routes are unaffected.
     * Runs after logger() so 429s appear in logs, and before session() since
     * the mobile prefix is in publicPaths anyway — short-circuit early.
     */
    server.use("/api/mobile/*", mobileIpRateLimit());

    /**
     * Calendar iCal feed rate limit. Scoped to the feed route; the feed is
     * public (secret-token auth, in publicPaths) and runs an unpaginated
     * windowed query, so cap each feed (keyed by its token path) before the
     * handler runs.
     */
    server.use("/api/calendar/feed/*", calendarFeedRateLimit());

    /**
     * Add session middleware
     */
    server.use(
      session({
        autoCommit: true,
        createSessionStorage() {
          const sessionStorage = createSessionStorage();

          return {
            ...sessionStorage,
            // If a user doesn't come back to the app within 3 days, their session will be deleted.
            async commitSession(session) {
              return sessionStorage.commitSession(session, {
                maxAge: 60 * 60 * 24 * 3, // 3 days
              });
            },
          };
        },
      })
    );

    /**
     * Guard single-fetch loader (`*.data`) revalidations against runaway client
     * loops that can exhaust the DB connection pool. Keyed per (user, path) so
     * normal navigation (varied paths) is unaffected; `/__*` (manifest) and SSE
     * streams are not `.data`, so they are excluded.
     *
     * Registered BEFORE refreshSession()/protect() on purpose: protect() runs
     * validateSession(), a Prisma query against `auth.refresh_tokens`, on every
     * request. If the limiter ran after it, each over-limit request would still
     * burn a DB connection before being rejected — defeating the guard, whose
     * whole point is to keep a runaway loop off the DB hot path. Here it reads
     * the user id straight from the parsed cookie session and 429s with zero DB
     * work.
     *
     * The limiter is instantiated ONCE so its in-memory store accumulates counts
     * across requests; a per-request instance would reset the count every time.
     * A manual matcher (not `server.use(pattern, ...)`) is needed because the
     * match is a `.data` *suffix*, not a path prefix.
     */
    const appLoaderLimiter = appLoaderRateLimit();
    server.use("*", async (c, next) => {
      const p = c.req.path;
      if (!p.endsWith(".data") || p.startsWith("/__")) return next();
      // `appLoaderLimiter` is typed with hono's default `Env`; our server uses a
      // custom `ServerEnv`. Cast to bridge the generic — the runtime context is
      // the same object Hono passes to every middleware.
      return appLoaderLimiter(c as unknown as Context, next);
    });

    /**
     * Add refresh session middleware
     *
     */
    server.use("*", refreshSession());

    /**
     * Add protected routes middleware
     *
     */
    server.use(
      "*",
      protect({
        onFailRedirectTo: "/login",
        publicPaths: [
          "/",
          "/_root", // Root layout loader - needed for all pages including public routes
          "/accept-invite/*path", // *path is a named wildcard matching any path after /accept-invite
          "/forgot-password",
          "/join",
          "/login",
          "/sso-login",
          "/oauth/callback",
          "/oauth/callback/mobile", // Native-app SSO callback (web-delegated)
          "/logout",
          "/otp",
          "/resend-otp",
          "/reset-password",
          "/send-otp",
          "/healthcheck",
          // Native-app deep-link association files (iOS Universal Links /
          // Android App Links). Must be publicly reachable — the OS fetches
          // them unauthenticated to verify the Companion app's domain claim.
          "/.well-known/apple-app-site-association",
          "/.well-known/assetlinks.json",
          "/api/public-stats",
          "/api/oss-friends",
          "/api/stripe-webhook",
          "/qr",
          "/qr/:qrId",
          "/qr/:qrId/not-logged-in",
          "/qr/:qrId/contact-owner",
          "/api/mobile/*path", // Mobile companion app API (JWT auth, not cookie)
          // why: auth-bypassed. The iCal feed authenticates via a secret URL
          // token (calendar clients can't send cookies). Scoped to the feed
          // route only — cookie-authed routes like /api/calendar-subscription
          // stay OUT of this prefix.
          "/api/calendar/feed/*path",
        ],
      })
    );
  },
});

/**
 * Declare our loaders and actions context type
 */
declare module "react-router" {
  interface AppLoadContext {
    /**
     * The app version from the build assets
     */
    readonly appVersion: string;
    /**
     * Whether the user is authenticated or not
     */
    isAuthenticated: boolean;
    /**
     * Get the current session
     *
     * If the user is not logged it will throw an error
     *
     * @returns The session
     */
    getSession(): SessionData["auth"];
    /**
     * Set the session to the session storage
     *
     * It will then be automatically handled by the session middleware
     *
     * @param session - The auth session to commit
     */
    setSession(session: SessionData["auth"]): void;
    /**
     * Destroy the session from the session storage middleware
     *
     * It will then be automatically handled by the session middleware
     */
    destroySession(): void;
    /**
     * The flash error message related to session
     */
    errorMessage: string | null;
  }
}
