import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import * as serverBuild from "@remix-run/dev/server-build";
import type { AppLoadContext, ServerBuild } from "@remix-run/node";
import { createCookieSessionStorage } from "@remix-run/node";
import { broadcastDevReady } from "@remix-run/server-runtime";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { remix } from "remix-hono/handler";
import { getSession, session } from "remix-hono/session";

import { initEnv, env } from "~/utils/env";
import { ShelfStackError } from "~/utils/error";

import { cache, protect, refreshSession } from "./middleware";
import { authSessionKey, type FlashData, type SessionData } from "./session";

// Server will not start if the env is not valid
initEnv();

const build = serverBuild as ServerBuild;

const mode = env.NODE_ENV === "test" ? "development" : env.NODE_ENV;

const app = new Hono();

/**
 * Serve build files from public/build
 */
app.use(
  "/build/*",
  cache(60 * 60 * 24 * 365), // 1 year
  serveStatic({ root: "./public" })
);

/**
 * Serve static files from public
 */
app.use("*", cache(60 * 60), serveStatic({ root: "./public" })); // 1 hour

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
      const sessionStorage = createCookieSessionStorage({
        cookie: {
          name: "__authSession",
          httpOnly: true,
          path: "/",
          sameSite: "lax",
          secrets: [env.SESSION_SECRET],
          secure: env.NODE_ENV === "production",
        },
      });

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
app.use(refreshSession());

/**
 * Add protected routes middleware
 *
 */
app.use(
  protect({
    onFailRedirectTo: "/auth/sign-in",
    publicPaths: [
      "/",
      "/auth/:path*", // :path* is a wildcard that will match any path after /auth
      "/healthcheck",
    ],
  })
);

/**
 * Add remix middleware to Hono server
 */
app.use(
  remix({
    // @ts-ignore
    build,
    mode,
    getLoadContext(context) {
      const session = getSession<SessionData, FlashData>(context);

      return {
        // Nice to have if you want to display the app version or do something in the app when deploying a new version
        // Exemple: on navigate, check if the app version is the same as the one in the build assets and if not, display a toast to the user to refresh the page
        // Prevent the user to use an old version of the client side code (it is only downloaded on document request)
        appVersion: build.assets.version,
        isAuthenticated: session.has(authSessionKey),
        // we could ensure that session.get() match a specific shape
        // let's trust our system for now
        getSession: () => {
          const auth = session.get(authSessionKey);

          if (!auth) {
            throw new ShelfStackError({
              cause: null,
              message:
                "There is no session here. This should not happen because if you require it, this route should be mark as protected and catch by the protect middleware.",
              status: 403,
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
  })
);

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
serve(
  mode === "production"
    ? {
        ...app,
        port: Number(process.env.PORT) || 3000,
      }
    : {
        ...app, // 👇 is for https dev server. If you go that route, remove `...app`
        // fetch: app.fetch,
        // createServer: createSecureServer, // import { createSecureServer } from "node:http2";
        // serverOptions: {
        // 	key: fs.readFileSync("./server/dev/key.pem"), // import fs from "node:fs";
        // 	cert: fs.readFileSync("./server/dev/cert.pem"),
        // },
        port: Number(process.env.PORT) || 3000,
      },
  async (info) => {
    // eslint-disable-next-line no-console
    console.log(`🚀 Server started on port ${info.port}`);

    if (mode === "development") {
      const os = await import("node:os");
      const dns = await import("node:dns");
      await new Promise((resolve) => {
        dns.lookup(os.hostname(), 4, (_, address) => {
          // If you want to use https dev server, you need to change http to https
          // eslint-disable-next-line no-console
          console.log(
            `🌍 http://localhost:${info.port} - http://${
              address || info.address
            }:${info.port}`
          );

          resolve(null);
        });
      });

      broadcastDevReady(build);
    }
  }
);
