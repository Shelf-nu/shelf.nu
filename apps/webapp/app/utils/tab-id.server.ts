/**
 * Per-request tab identifier using AsyncLocalStorage.
 *
 * Each browser tab sends a unique `X-Tab-Id` header with every request.
 * The Hono middleware stores it here so that `sendNotification()` can
 * automatically tag notifications with the originating tab, allowing the
 * SSE handler to deliver toasts only to the tab that triggered the action.
 *
 * Background jobs (pg-boss workers, schedulers) run outside a request
 * context, so `getTabId()` returns `undefined` for them — their
 * notifications are broadcast to every tab of the target user.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const tabIdStorage = new AsyncLocalStorage<string | undefined>();

/** Wrap downstream handlers so `getTabId()` returns the caller's tab id. */
export function runWithTabId<T>(tabId: string | undefined, fn: () => T): T {
  return tabIdStorage.run(tabId, fn);
}

/** Read the current request's tab id (undefined outside a request). */
export function getTabId(): string | undefined {
  return tabIdStorage.getStore();
}
