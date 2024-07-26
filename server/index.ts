// import the Sentry instrumentation file before anything else.
// It is important to import it as .js for this to work, even if the file is .ts
import "./instrument.server.js";

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import type { AppLoadContext, ServerBuild } from "@remix-run/node";
import { Hono } from "hono";
import { remix } from "remix-hono/handler";
import { getSession, session } from "remix-hono/session";

import { initEnv, env } from "~/utils/env";
import { ShelfError } from "~/utils/error";

import { importDevBuild } from "./dev/server";
import { logger } from "./logger";
import { cache, protect, refreshSession, urlShortener } from "./middleware";
import { authSessionKey, createSessionStorage } from "./session";
import type { FlashData, SessionData } from "./session";

// Server will not start if the env is not valid
initEnv();

/**
 * installGlobals from remix doesnt work as it conflicts with some other packages that we use and overrides some of their types
 * In our case the only type causing issue is File and it only happens in development mode
 * So we will import it conditionally in development mode
 * */
if (env.NODE_ENV !== "production") {
  void import("@remix-run/web-fetch").then((webFetch) => {
    global.File = webFetch.File;
  });
}

const mode = env.NODE_ENV === "test" ? "development" : env.NODE_ENV;

const isProductionMode = mode === "production";

const app = new Hono();

/**
 * Add url shortner middleware
 */
app.use("*", urlShortener());

/**
 * Serve assets files from build/client/assets
 */
app.use(
  "/file-assets/*",
  cache(60 * 60 * 24 * 365), // 1 year
  serveStatic({ root: "./build/client" })
);

/**
 * Serve public files
 */
app.use(
  "*",
  cache(60 * 60),
  serveStatic({ root: isProductionMode ? "./build/client" : "./public" })
); // 1 hour

/**
 * Add logger middleware
 */
app.use("*", logger());

/**
 * Add session middleware
 */
app.use(
  session({
    autoCommit: true,
    createSessionStorage() {
      const sessionStorage = createSessionStorage();

      return {
        ...sessionStorage,
        // If a user doesn't come back to the app within 30 days, their session will be deleted.
        async commitSession(session) {
          return sessionStorage.commitSession(session, {
            maxAge: 60 * 60 * 24 * 30, // 30 days
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
app.use("*", refreshSession());

/**
 * Add protected routes middleware
 *
 */
app.use(
  "*",
  protect({
    onFailRedirectTo: "/login",
    publicPaths: [
      "/",
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

/**
 * Add remix middleware to Hono server
 */
app.use(async (c, next) => {
  const build = (isProductionMode
    ? // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      // eslint-disable-next-line import/no-unresolved -- this expected until you build the app
      await import("../build/server/remix.js")
    : await importDevBuild()) as unknown as ServerBuild;

  return remix({
    build,
    mode,
    getLoadContext(context) {
      const session = getSession<SessionData, FlashData>(context);

      return {
        // Nice to have if you want to display the app version or do something in the app when deploying a new version
        // Exemple: on navigate, check if the app version is the same as the one in the build assets and if not, display a toast to the user to refresh the page
        // Prevent the user to use an old version of the client side code (it is only downloaded on document request)
        appVersion: isProductionMode ? build.assets.version : "dev",
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
    },
  })(c, next);
});

/**
 * Declare our loaders and actions context type
 */
declare module "@remix-run/node" {
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

/**
 * Start the server
 */
if (isProductionMode) {
  serve(
    {
      ...app,
      port: Number(process.env.PORT) || 3000,
    },
    (info) => {
      // eslint-disable-next-line no-console
      console.log(`🚀 Server started on port ${info.port}`);
    }
  );
}

export default app;
