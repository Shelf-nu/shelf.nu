/**
 * Listeners for refused (403) API responses.
 *
 * A 403 can mean the open workspace became inactive while the app was open,
 * which only `/api/mobile/me` can confirm, so the workspace context listens
 * here and re-reads it. The API client calls {@link notifyForbidden} on a
 * 403 (except for `/me` itself, see {@link recheckAfterRefusal}); a 401
 * (signed out) goes through the auth-error listener instead.
 *
 * @see lib/api/client.ts
 * @see lib/org-context.tsx
 */

type ForbiddenListener = () => void;
const forbiddenListeners = new Set<ForbiddenListener>();

/**
 * Subscribes to refused responses.
 *
 * @param listener - Called once per 403 response.
 * @returns A function that unsubscribes.
 */
export function onForbidden(listener: ForbiddenListener): () => void {
  forbiddenListeners.add(listener);
  return () => {
    forbiddenListeners.delete(listener);
  };
}

/** Tells every listener a request was refused with a 403. */
export function notifyForbidden(): void {
  forbiddenListeners.forEach((listener) => listener());
}

/** The workspace context's own read, which the re-check calls. */
const WORKSPACE_READ_PATH = "/api/mobile/me";

/**
 * Whether a refused request should set off the workspace re-check. Not for
 * `/api/mobile/me` itself: that is the re-check's own read, and a refusal
 * there (for one, a session the server no longer accepts) has nothing to do
 * with a workspace becoming inactive, so re-reading it would only repeat
 * the refusal every gap.
 *
 * @param path - The refused request's path, query included.
 * @returns `false` for the workspace context's own read.
 */
export function recheckAfterRefusal(path: string): boolean {
  const [pathname] = path.split("?");
  return pathname !== WORKSPACE_READ_PATH;
}
