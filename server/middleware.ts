import { createMiddleware } from "hono/factory";
import { pathToRegexp } from "path-to-regexp";
import { getSession } from "remix-hono/session";

import {
  refreshAccessToken,
  validateSession,
} from "~/modules/auth/service.server";
import { ShelfError } from "~/utils/error";
import { safeRedirect } from "~/utils/http.server";
import { isQrId } from "~/utils/id";
import { Logger } from "~/utils/logger";
import type { FlashData, SessionData } from "./session";
import { authSessionKey } from "./session";

/**
 * Ensure host headers for React Router CSRF protection
 * React Router v7.12+ requires host or x-forwarded-host headers
 * In dev mode, Vite dev server doesn't always preserve these headers
 * Only applied in development - production environments have headers intact
 */
export function ensureHostHeaders() {
  return createMiddleware(async (c, next) => {
    // Only apply this fix in development mode
    if (process.env.NODE_ENV === "production") {
      return next();
    }

    const originalRequest = c.req.raw;
    const host = originalRequest.headers.get("host");
    const forwardedHost = originalRequest.headers.get("x-forwarded-host");

    // If both headers are missing, create a new Request with host header
    if (!host && !forwardedHost) {
      const headers = new Headers(originalRequest.headers);
      // Use the URL host from the request
      const url = new URL(originalRequest.url);
      headers.set("host", url.host);

      // Create new Request with the updated headers
      const newRequest = new Request(originalRequest.url, {
        method: originalRequest.method,
        headers,
        body: originalRequest.body,
        // @ts-expect-error - duplex is required for streaming bodies
        duplex: "half",
      });

      // Replace the request in the context
      c.req.raw = newRequest;
    }

    return next();
  });
}

/**
 * Protected routes middleware
 *
 * @param options.publicPath - The public paths
 * @param options.onFailRedirectTo - The path to redirect to if the user is not logged in
 */
export function protect({
  publicPaths,
  onFailRedirectTo,
}: {
  publicPaths: string[];
  onFailRedirectTo: string;
}) {
  return createMiddleware(async (c, next) => {
    // Skip authentication for internal Remix/framework routes (manifest, etc.)
    // These are created by lazy route discovery and should never require auth
    if (c.req.path.startsWith("/__")) {
      return next();
    }

    // TODO: Remove this workaround when migrating to React Router v7 + react-router-hono-server v2
    // v2 of react-router-hono-server should handle .data suffix internally
    // For single fetch routes (*.data), strip the .data suffix before checking public paths
    // This ensures /login.data is treated the same as /login for auth purposes
    const pathToCheck = c.req.path.endsWith(".data")
      ? c.req.path.slice(0, -5)
      : c.req.path;

    const isPublic = pathMatch(publicPaths, pathToCheck);

    if (isPublic) {
      return next();
    }
    const session = getSession<SessionData, FlashData>(c);
    const auth = session.get(authSessionKey);

    if (!auth) {
      session.flash(
        "errorMessage",
        "This content is only available to logged in users."
      );

      return c.redirect(`${onFailRedirectTo}?redirectTo=${c.req.path}`);
    }
    const isValidSession = await validateSession(auth.refreshToken);

    if (!isValidSession) {
      session.flash(
        "errorMessage",
        "Session might have expired. Please log in again."
      );
      session.unset(authSessionKey);
      Logger.error(
        new ShelfError({
          cause: null,
          message: "Session might have expired. Please log in again.",
          label: "Auth",
          shouldBeCaptured: false,
        })
      );
      return c.redirect(`${onFailRedirectTo}?redirectTo=${c.req.path}`);
    }
    return next();
  });
}

function pathMatch(paths: string[], requestPath: string) {
  for (const path of paths) {
    const regex = pathToRegexp(path);

    if (regex.test(requestPath)) {
      return true;
    }
  }

  return false;
}

function isExpiringSoon(expiresAt: number | undefined) {
  if (!expiresAt) {
    return true;
  }

  return (expiresAt - 60 * 0.1) * 1000 < Date.now(); // 1 minute left before token expires
}

/**
 * Refresh access token middleware
 *
 */
export function refreshSession() {
  return createMiddleware(async (c, next) => {
    const session = getSession<SessionData, FlashData>(c);
    const auth = session.get(authSessionKey);

    if (!auth || !isExpiringSoon(auth.expiresAt)) {
      return next();
    }

    try {
      session.set(authSessionKey, await refreshAccessToken(auth.refreshToken));
    } catch (_cause) {
      session.flash(
        "errorMessage",
        "You have been logged out. Please log in again."
      );

      session.unset(authSessionKey);
    }

    return next();
  });
}

/**
 * Cache middleware
 *
 * @param seconds - The number of seconds to cache
 */
export function cache(seconds: number) {
  return createMiddleware(async (c, next) => {
    if (!c.req.path.match(/\.[a-zA-Z0-9]+$/) || c.req.path.endsWith(".data")) {
      return next();
    }

    await next();

    if (!c.res.ok) {
      return;
    }

    c.res.headers.set("cache-control", `public, max-age=${seconds}`);
  });
}

/**
 * URL shortner middleware
 */

export function urlShortener({ excludePaths }: { excludePaths: string[] }) {
  return createMiddleware(async (c, next) => {
    const fullPath = c.req.path;

    // In react-router-hono-server v2, we no longer use getPath to prepend the host
    // The path is just the regular path, so no need to remove URL_SHORTENER prefix
    const pathParts = fullPath.split("/").filter(Boolean);
    const pathname = "/" + pathParts.join("/");

    // console.log(`urlShortener middleware: Processing ${pathname}`);

    // Check if the current request path matches any of the excluded paths
    const isExcluded = excludePaths.some((path) => pathname.startsWith(path));
    if (isExcluded) {
      // console.log(
      //   `urlShortener middleware: Skipping excluded path ${pathname}`
      // );
      return next();
    }

    const path = pathParts.join("/");
    const serverUrl = process.env.SERVER_URL;

    // Check if the path is a single segment and a valid CUID
    if (pathParts.length === 1 && isQrId(path)) {
      const redirectUrl = `${serverUrl}/qr/${path}`;
      // console.log(`urlShortener middleware: Redirecting QR to ${redirectUrl}`);
      return c.redirect(safeRedirect(redirectUrl), 301);
    }

    // console.log(`urlShortener middleware: Redirecting to ${serverUrl}`);
    /**
     * In all other cases, we just redirect to the app root.
     * The URL shortener should only be used for QR codes
     * */
    return c.redirect(safeRedirect(serverUrl), 301);
  });
}
