import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import * as serverBuild from "@remix-run/dev/server-build";
import type { AppLoadContext, ServerBuild } from "@remix-run/node";
import { createCookieSessionStorage } from "@remix-run/node";
import { broadcastDevReady } from "@remix-run/server-runtime";
import { Hono } from "hono";
import { remix } from "remix-hono/handler";
import { session } from "remix-hono/session";

import { supabaseClient } from "~/integrations/supabase";
import { mapAuthSession } from "~/modules/auth/mappers.server";
import { initEnv, env } from "~/utils/env";
import { ShelfStackError } from "~/utils/error";

import { logger } from "./logger";
import { cache, protect, refreshSession } from "./middleware";
import type { SessionData } from "./session";

/** For some reason the globals like File only work on production build
 * In development, we need to install them manually
 */
if (env.NODE_ENV !== "production") {
  var webFetch = require("@remix-run/web-fetch");
  global.File = webFetch.File;
}

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
app.use(
  "/static/*",
  cache(60 * 60), // cache for 1 hour
  serveStatic({ root: "./public" })
);

/**
 * Add logger middleware
 */
app.use("*", logger());

/**
 * Add session middleware
 */
app.use(
  //@ts-expect-error fixed soon
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
      "/accept-invite/:path*", // :path* is a wildcard that will match any path after /accept-invite
      "/forgot-password",
      "/join",
      "/login",
      "/logout",
      "/otp",
      "/resend-otp",
      "/reset-password",
      "/send-otp",
      "/verify-email",
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
app.use(
  //@ts-expect-error fixed soon
  remix({
    // @ts-ignore
    build,
    mode,
    async getLoadContext(context) {
      const {
        data: { session },
      } = await supabaseClient.auth.getSession();

      // const session = getSession<SessionData, FlashData>(context);

      return {
        // Nice to have if you want to display the app version or do something in the app when deploying a new version
        // Exemple: on navigate, check if the app version is the same as the one in the build assets and if not, display a toast to the user to refresh the page
        // Prevent the user to use an old version of the client side code (it is only downloaded on document request)
        appVersion: build.assets.version,
        isAuthenticated: Boolean(session),
        // we could ensure that session.get() match a specific shape
        // let's trust our system for now
        getSession: async () => {
          const {
            data: { session },
          } = await supabaseClient.auth.getSession();
          const mappedSession = await mapAuthSession(session);
          // const auth = session.get(authSessionKey);

          if (!mappedSession) {
            throw new ShelfStackError({
              cause: null,
              message:
                "There is no session here. This should not happen because if you require it, this route should be mark as protected and catch by the protect middleware.",
              status: 403,
            });
          }

          return mappedSession;
        },
        setSession: () => {
          // session.set(authSessionKey, auth);
        },
        destroySession: async () => {
          await supabaseClient.auth.signOut();
          // session.unset(authSessionKey);
        },
        errorMessage: null,
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
    getSession(): Promise<SessionData["auth"]>;
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
    destroySession(): Promise<void>;
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
