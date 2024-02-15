import { createMiddleware } from "hono/factory";
import { pathToRegexp } from "path-to-regexp";
import { getSession } from "remix-hono/session";

import { refreshAccessToken } from "~/modules/auth";
import { authSessionKey, type FlashData, type SessionData } from "./session";

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
    const isPublic = pathMatch(publicPaths, c.req.path);

    if (isPublic) {
      return next();
    }
    //@ts-expect-error fixed soon
    const session = getSession<SessionData, FlashData>(c);
    const auth = session.get(authSessionKey);

    if (!auth) {
      session.flash(
        "errorMessage",
        "This content is only available to logged in users."
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
    //@ts-expect-error fixed soon
    const session = getSession<SessionData, FlashData>(c);
    const auth = session.get(authSessionKey);

    if (!auth || !isExpiringSoon(auth.expiresAt)) {
      return next();
    }

    try {
      session.set(authSessionKey, await refreshAccessToken(auth.refreshToken));
    } catch (cause) {
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
    if (!c.req.path.match(/\.[a-zA-Z0-9]+$/)) {
      return next();
    }

    await next();

    if (!c.res.ok) {
      return;
    }

    c.res.headers.set("cache-control", `public, max-age=${seconds}`);
  });
}
