/**
 * Listeners for refused (403) API responses.
 *
 * A 403 can mean the open workspace became inactive while the app was open,
 * which only `/api/mobile/me` can confirm, so the workspace context listens
 * here and re-reads it. The API client calls {@link notifyForbidden} on every
 * 403; a 401 (signed out) goes through the auth-error listener instead.
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
