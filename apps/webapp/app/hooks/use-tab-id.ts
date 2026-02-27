import { useEffect, useRef } from "react";

const SESSION_KEY = "__shelfTabId";

/** Returns a stable, unique identifier for the current browser tab.
 * Patches `window.fetch` to send it as `X-Tab-Id` on same-origin requests. */
export function useTabId(): string {
  const tabIdRef = useRef("");

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
