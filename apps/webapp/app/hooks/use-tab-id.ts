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

    // Guard: skip patching if another instance of this hook already patched fetch
    if ((window.fetch as any).__shelfTabIdPatch) return;

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
        url.startsWith("/") ||
        (() => {
          try {
            return new URL(url).origin === window.location.origin;
          } catch {
            return false;
          }
        })();

      if (isSameOrigin) {
        const headers = new Headers(init?.headers);
        if (!headers.has("X-Tab-Id")) {
          headers.set("X-Tab-Id", tabId);
        }
        return originalFetch.call(window, input, { ...init, headers });
      }

      return originalFetch.call(window, input, init);
    };
    const patchedFetchRef = window.fetch;
    (patchedFetchRef as any).__shelfTabIdPatch = true;

    return () => {
      // Only restore if our patch is still the active one
      if (window.fetch === patchedFetchRef) {
        window.fetch = originalFetch;
      }
    };
  }, []);

  return tabIdRef.current;
}
