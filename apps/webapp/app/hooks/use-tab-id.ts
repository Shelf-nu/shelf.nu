/**
 * Per-tab identifier hook for browser tabs.
 *
 * Provides a stable, unique ID for the current browser tab and patches
 * `window.fetch` to inject an `X-Tab-Id` header on same-origin requests.
 * The server uses this header to scope SSE notifications to the originating tab.
 *
 * - Persists the ID in `sessionStorage` under {@link SESSION_KEY}
 * - Generates a fresh UUID for cloned/opened tabs (detected via `window.opener`)
 * - Mutates `window.fetch` to add the `X-Tab-Id` header automatically
 *
 * @see {@link file://./../components/shared/toast.tsx} — primary consumer
 * @see {@link file://./../utils/tab-id.server.ts} — server-side counterpart
 */
import { useEffect, useRef } from "react";

const SESSION_KEY = "__shelfTabId";

/**
 * Returns a stable, unique identifier for the current browser tab.
 *
 * **Side effects:**
 * - Persists the tab ID to `sessionStorage` under `SESSION_KEY`
 * - Patches `window.fetch` to send `X-Tab-Id` on same-origin requests
 *
 * @returns A stable unique string identifier for the current browser tab
 */
export function useTabId(): string {
  const tabIdRef = useRef("");

  if (!tabIdRef.current && typeof window !== "undefined") {
    const stored = sessionStorage.getItem(SESSION_KEY);
    // Cloned tabs (window.open / target="_blank") inherit sessionStorage,
    // so generate a fresh ID when an opener is detected.
    tabIdRef.current = stored && !window.opener ? stored : crypto.randomUUID();
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
        // Seed from Request.headers when input is a Request, then overlay
        // any headers from init so callers' overrides take precedence.
        const headers = new Headers(
          input instanceof Request ? input.headers : undefined
        );
        new Headers(init?.headers).forEach((v, k) => headers.set(k, v));
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
