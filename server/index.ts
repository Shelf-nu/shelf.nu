// import the Sentry instrumentation file before anything else.
// It is important to import it as .js for this to work, even if the file is .ts
import "./instrument.server.js";

import type { AppLoadContext } from "react-router";
import type { HonoServerOptions } from "react-router-hono-server/node";
import { createHonoServer } from "react-router-hono-server/node";
import { getSession, session } from "remix-hono/session";
import { initEnv } from "~/utils/env";
import { ShelfError } from "~/utils/error";

import { logger } from "./logger";
import {
  ensureHostHeaders,
  protect,
  refreshSession,
  urlShortener,
} from "./middleware";
import { authSessionKey, createSessionStorage } from "./session";
import type { FlashData, SessionData } from "./session";

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
  configure: (server) => {
    /**
     * Ensure host headers are present for React Router CSRF protection
     * Must be first to ensure headers are available for all downstream middleware
     */
    server.use("*", ensureHostHeaders());

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
          "/accept-invite/:path*", // :path* is a wildcard that will match any path after /accept-invite
          "/forgot-password",
          "/join",
          "/login",
          "/sso-login",
          "/oauth/callback",
          "/logout",
          "/otp",
          "/resend-otp",
          "/reset-password",
          "/send-otp",
          "/healthcheck",
          "/api/public-stats",
          "/api/oss-friends",
          "/api/stripe-webhook",
          "/qr",
          "/qr/:path*",
          "/qr/:path*/contact-owner",
          "/qr/:path*/not-logged-in",
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
