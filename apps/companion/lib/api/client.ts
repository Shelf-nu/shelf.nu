import {
  getActiveServer,
  subscribeToServerChange,
} from "../server/active-server";
import { getSupabase, getSupabaseClientUrl } from "../supabase";
import { isSessionServerMismatched } from "../server/contract";
import { reportServerMismatch } from "../sentry";

/**
 * Base URL of the Shelf server the app is currently connected to.
 *
 * Deliberately a function rather than the exported constant this used to be: a
 * captured `const` would silently keep pointing at whichever server was active
 * at import time, and neither typecheck nor unit tests can see that mistake —
 * only using the app against a second server would.
 *
 * The Shelf Cloud default (including the `__DEV__` fallback split) now lives on
 * `CLOUD_SERVER` in `lib/server/active-server.ts`.
 *
 * @returns The active server's origin, without a trailing slash.
 */
export function getApiBaseUrl(): string {
  return getActiveServer().baseUrl;
}

/**
 * Global auth error listener.
 * Screens can subscribe to be notified when the session expires
 * so they can redirect to the login screen.
 */
type AuthErrorListener = () => void;
const authErrorListeners = new Set<AuthErrorListener>();
export function onAuthError(listener: AuthErrorListener): () => void {
  authErrorListeners.add(listener);
  return () => authErrorListeners.delete(listener);
}
export function notifyAuthError() {
  authErrorListeners.forEach((fn) => fn());
}

/** Default request timeout (20 seconds -- generous for first cold-start request) */
const REQUEST_TIMEOUT_MS = 20_000;

/** Max automatic retries for timeout/network errors */
const MAX_RETRIES = 1;

// ── Session cache ──────────────────────────────────────
// Cache the Supabase session in memory to avoid repeated SecureStore reads.
// Each getSession() call reads encrypted data from disk (2-3 chunks on iOS).
// With dozens of API calls per navigation, this eliminates massive I/O overhead.
const SESSION_CACHE_TTL_MS = 30_000; // 30 seconds
let cachedAccessToken: string | null = null;
let cachedAt = 0;

/** Unsubscribe handle for the current client's auth listener. */
let authSubscription: { unsubscribe: () => void } | null = null;

/** Clears the in-memory access-token cache. */
function resetAccessTokenCache(): void {
  cachedAccessToken = null;
  cachedAt = 0;
}

/**
 * Subscribes the token cache to the CURRENT Supabase client's auth events
 * (login, logout, token refresh).
 *
 * Re-called after every server switch: otherwise the cache keeps listening to
 * the discarded client, silently stops invalidating, and hands the previous
 * server's access token to the new one.
 */
function attachAuthListener(): void {
  authSubscription?.unsubscribe();
  const {
    data: { subscription },
  } = getSupabase().auth.onAuthStateChange(() => {
    resetAccessTokenCache();
  });
  authSubscription = subscription;
}

attachAuthListener();

// why: this module owns the token cache and the auth subscription, so it — not
// active-server.ts — rearms them after a switch. Wiring it as a subscription
// keeps the dependency one-way (api → server); importing these functions INTO
// active-server.ts would create a require cycle, which Metro resolves to
// `undefined` at module-eval time and surfaces far from the cause.
subscribeToServerChange(() => {
  resetAccessTokenCache();
  attachAuthListener();
});

/**
 * Refuses the request when the live Supabase client belongs to a different
 * project than the active server.
 *
 * `apiFetch` / `apiUpload` are the single chokepoint every authenticated
 * request passes through, which makes this the one place the core invariant of
 * multi-server support can actually be enforced: the token we are about to send
 * was minted by the server we are about to send it to.
 *
 * It should never fire — `setActiveServer` signs out and rebuilds before
 * notifying anyone, and sessions are namespaced per Supabase project. It exists
 * because "cannot happen by construction" is exactly what was believed about
 * several guards on this feature that turned out to be reachable. Failing
 * closed converts a silent cross-server credential leak into a clean re-auth.
 *
 * @returns An error result when the request must not proceed, otherwise null.
 */
function guardSessionServerMatch(): { data: null; error: string } | null {
  const active = getActiveServer();
  if (!isSessionServerMismatched(getSupabaseClientUrl(), active.supabaseUrl)) {
    return null;
  }

  // Loud on purpose: this is a bug, not a user condition, and it is invisible
  // from the outside — the user would just see an unexplained sign-out.
  reportServerMismatch(getSupabaseClientUrl(), active.supabaseUrl);
  resetAccessTokenCache();
  notifyAuthError();
  return {
    data: null,
    error: "Session expired. Please sign in again.",
  };
}

/** Returns a valid access token, using cache when possible. */
export async function getAccessToken(): Promise<string | null> {
  const now = Date.now();
  if (cachedAccessToken && now - cachedAt < SESSION_CACHE_TTL_MS) {
    return cachedAccessToken;
  }
  const {
    data: { session },
  } = await getSupabase().auth.getSession();
  if (session?.access_token) {
    cachedAccessToken = session.access_token;
    cachedAt = now;
    return cachedAccessToken;
  }
  cachedAccessToken = null;
  cachedAt = 0;
  return null;
}

/**
 * `RequestInit` plus companion-specific knobs. `retry: false` opts a request
 * out of the automatic timeout/network retry — required for non-idempotent
 * mutations (e.g. quantity custody assign/release) where a timed-out-but-
 * landed first request must not be re-sent and double-applied. Reads and
 * idempotent calls keep the default retry behaviour.
 */
export type ApiFetchOptions = RequestInit & { retry?: boolean };

/**
 * Structured error payload from the mobile API's `{ error: { … } }` envelope.
 * `message` mirrors the flat `error` string consumers already display.
 * `reason` is an additive machine-readable discriminator some endpoints emit
 * (today: `"unclaimed"` on the QR RESOLVE routes only — the link route claims
 * unclaimed codes inline and no longer emits it), with `qrId` echoing
 * the scanned code id whenever `reason` is present. Branch on `reason`, never
 * on `message` text — messages are human copy and can change; the reason
 * field is the wire contract.
 */
export type ApiErrorDetails = {
  message: string;
  reason?: string;
  qrId?: string;
};

/**
 * Extracts the structured error payload from a parsed non-OK response body.
 *
 * @param json - The parsed response body (unknown: may be an HTML error page
 *   coerced to null, an empty body, or a proxy's own JSON).
 * @returns The typed error payload, or `null` when the body doesn't match the
 *   mobile API's `{ error: { message } }` envelope.
 */
function extractErrorDetails(json: unknown): ApiErrorDetails | null {
  if (typeof json !== "object" || json === null) return null;
  const err = (json as { error?: unknown }).error;
  if (typeof err !== "object" || err === null) return null;
  const { message, reason, qrId } = err as {
    message?: unknown;
    reason?: unknown;
    qrId?: unknown;
  };
  if (typeof message !== "string") return null;
  return {
    message,
    ...(typeof reason === "string" ? { reason } : {}),
    ...(typeof qrId === "string" ? { qrId } : {}),
  };
}

/**
 * Makes an authenticated API call to the Shelf webapp.
 * Automatically attaches the current Supabase session JWT.
 * - Returns structured { data, error } -- never throws.
 * - On HTTP errors carrying the mobile API's `{ error: { … } }` envelope,
 *   `errorDetails` additionally exposes the structured payload (message +
 *   optional machine-readable `reason` / `qrId`) so callers can branch on
 *   contract fields instead of message strings. Absent for transport-level
 *   failures (timeout, network, non-JSON bodies).
 * - Detects 401/session-expired and notifies global auth listeners.
 * - Enforces a request timeout to avoid hanging on slow networks.
 */
export async function apiFetch<T>(
  path: string,
  options: ApiFetchOptions = {},
  _retryCount = 0
): Promise<{
  data: T | null;
  error: string | null;
  errorDetails?: ApiErrorDetails | null;
}> {
  // Declared outside try so catch block can read it
  let timedOut = false;

  try {
    const mismatch = guardSessionServerMatch();
    if (mismatch) return mismatch;

    const accessToken = await getAccessToken();

    if (!accessToken) {
      notifyAuthError();
      return { data: null, error: "Session expired. Please sign in again." };
    }

    const url = `${getApiBaseUrl()}${path}`;
    if (__DEV__)
      console.log(
        "[API] Fetching:",
        url,
        _retryCount > 0 ? `(retry ${_retryCount})` : ""
      );

    // Abort controller for timeout — tag it so we can distinguish
    // timeout aborts from user/navigation aborts
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

    // If caller provided a signal (e.g. from useEffect cleanup), chain it
    if (options.signal) {
      options.signal.addEventListener("abort", () => controller.abort());
    }

    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...options.headers,
      },
    });
    clearTimeout(timeoutId);

    // Safe JSON parsing — server may return HTML error pages or empty body
    let json: any;
    try {
      const text = await response.text();
      json = text ? JSON.parse(text) : null;
    } catch {
      if (!response.ok) {
        return { data: null, error: `Server error (${response.status})` };
      }
      return { data: null, error: "Invalid response from server" };
    }

    if (!response.ok) {
      // 401 = unauthenticated → session expired, redirect to login
      if (response.status === 401) {
        notifyAuthError();
        return {
          data: null,
          error: "Session expired. Please sign in again.",
        };
      }
      const errorDetails = extractErrorDetails(json);
      // 403 = forbidden → user lacks permission, but session is valid
      if (response.status === 403) {
        return {
          data: null,
          error:
            json?.error?.message ||
            "You don't have permission to perform this action.",
          errorDetails,
        };
      }
      return {
        data: null,
        error: json?.error?.message || `Request failed (${response.status})`,
        errorDetails,
      };
    }

    return { data: json as T, error: null };
  } catch (err) {
    // Navigation/cleanup abort — silently return null (not an error)
    if (err instanceof Error && err.name === "AbortError" && !timedOut) {
      if (__DEV__) console.log("[API] Request cancelled (navigation):", path);
      return { data: null, error: null };
    }

    // Auto-retry on timeout or network errors (not on auth/permission
    // errors). Requests sent with `retry: false` are exempt: a timed-out
    // POST may have landed server-side, and re-sending a non-idempotent
    // mutation would double-apply it.
    const isRetryable =
      (err instanceof Error && err.name === "AbortError" && timedOut) ||
      err instanceof TypeError; // TypeError = network failure
    const willRetry =
      isRetryable && options.retry !== false && _retryCount < MAX_RETRIES;

    // why warn, not error, when a retry follows: in development React
    // Native's LogBox promotes every console.error into a full-screen red
    // overlay. A timeout we are about to retry — and usually recover from —
    // is not worth stopping the app for, and on a slow or flaky connection
    // it made the app unusable for testing while nothing was actually
    // broken. Reserve the red box for the request that has given up.
    if (__DEV__) {
      const log = willRetry ? console.warn : console.error;
      log("[API] Fetch failed:", path, err);
    }

    if (willRetry) {
      if (__DEV__) console.log("[API] Retrying…", path);
      return apiFetch<T>(path, options, _retryCount + 1);
    }

    if (err instanceof Error && err.name === "AbortError") {
      return { data: null, error: "Request timed out. Check your connection." };
    }
    return {
      data: null,
      error: err instanceof Error ? err.message : "Network request failed",
    };
  }
}

/**
 * Makes an authenticated multipart upload to the Shelf webapp.
 * Used for image uploads where we send FormData instead of JSON.
 */
export async function apiUpload<T>(
  path: string,
  formData: FormData
): Promise<{ data: T | null; error: string | null }> {
  try {
    const mismatch = guardSessionServerMatch();
    if (mismatch) return mismatch;

    const accessToken = await getAccessToken();

    if (!accessToken) {
      notifyAuthError();
      return { data: null, error: "Session expired. Please sign in again." };
    }

    const url = `${getApiBaseUrl()}${path}`;
    if (__DEV__) console.log("[API] Uploading to:", url);

    // Abort controller for timeout (longer than regular fetch for uploads)
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_MS * 4
    );

    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        // Do NOT set Content-Type — fetch auto-sets it with the multipart boundary
      },
      body: formData,
    });
    clearTimeout(timeoutId);

    // Safe JSON parsing — server may return HTML error pages or empty body
    let json: any;
    try {
      const text = await response.text();
      json = text ? JSON.parse(text) : null;
    } catch {
      if (!response.ok) {
        return { data: null, error: `Upload failed (${response.status})` };
      }
      return { data: null, error: "Invalid response from server" };
    }

    if (!response.ok) {
      if (response.status === 401) {
        notifyAuthError();
        return { data: null, error: "Session expired. Please sign in again." };
      }
      if (response.status === 403) {
        return {
          data: null,
          error:
            json?.error?.message ||
            "You don't have permission to perform this action.",
        };
      }
      return {
        data: null,
        error: json?.error?.message || `Upload failed (${response.status})`,
      };
    }

    return { data: json as T, error: null };
  } catch (err) {
    if (__DEV__) console.error("[API] Upload error:", err);
    if (err instanceof Error && err.name === "AbortError") {
      return { data: null, error: "Upload timed out. Check your connection." };
    }
    return {
      data: null,
      error: err instanceof Error ? err.message : "Upload failed",
    };
  }
}
