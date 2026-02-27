import { useEffect, useRef } from "react";

/**
 * Returns a stable, unique identifier for the current browser tab.
 *
 * The id is persisted in `sessionStorage` so it survives soft navigations and
 * React re-renders but is unique per tab (each tab gets its own
 * `sessionStorage` partition).
 *
 * On the server (SSR) this returns an empty string, which is safe to use as a
 * query-param default — the SSE connection is only opened on the client.
 *
 * As a side-effect, this hook patches `window.fetch` to attach an `X-Tab-Id`
 * header to every same-origin request.  The Hono middleware reads this header
 * and stores it in AsyncLocalStorage, so `sendNotification()` can
 * automatically tag each toast with the originating tab.
 *
 * @see https://github.com/Shelf-nu/shelf.nu/issues/1000
 */
const SESSION_KEY = "__shelfTabId";

export function useTabId(): string {
  const tabIdRef = useRef("");

  // Eagerly compute tabId so the SSE URL already contains it on first render
  if (!tabIdRef.current && typeof window !== "undefined") {
    tabIdRef.current =
      sessionStorage.getItem(SESSION_KEY) || crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, tabIdRef.current);
  }

  useEffect(() => {
    const tabId = tabIdRef.current;
    if (!tabId) return;

    const originalFetch = window.fetch;

    window.fetch = function patchedFetch(
      input: RequestInfo | URL,
      init?: RequestInit
    ) {
      // Only add the header to same-origin requests to avoid CORS issues
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
          ? input.href
          : input.url;
      const isSameOrigin =
        url.startsWith("/") || url.startsWith(window.location.origin);

      if (isSameOrigin) {
        const headers = new Headers(init?.headers);
        if (!headers.has("X-Tab-Id")) {
          headers.set("X-Tab-Id", tabId);
        }
        return originalFetch.call(window, input, { ...init, headers });
      }

      return originalFetch.call(window, input, init);
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  return tabIdRef.current;
}
