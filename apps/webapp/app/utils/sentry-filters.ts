/**
 * Client-side Sentry event filtering.
 *
 * Single source of truth for two related decisions made on the browser:
 *
 * 1. Which HTTP statuses the error-boundary treats as EXPECTED terminal
 *    states (not bugs) and therefore must NOT create Sentry issues for
 *    (`EXPECTED_ERROR_BOUNDARY_STATUSES` + `isExpectedErrorBoundaryStatus`).
 *    Consumed at the capture site (`~/components/errors` `ErrorContent`).
 * 2. The client `beforeSend` hook body (`handleClientBeforeSend`) — extracted
 *    out of `entry.client.tsx` (which hydrates on import and can't be unit
 *    tested) so the drop/keep rules are directly testable.
 *
 * @see {@link file://./../entry.client.tsx} — wires `handleClientBeforeSend`
 * @see {@link file://./../components/errors/index.tsx} — the capture site
 * @see {@link file://./../../server/instrument.server.ts} — server counterpart
 */
import type { ErrorEvent } from "@sentry/react-router";
import { MODULE_LOAD_FAILURE_PATTERN } from "./build-version";

/**
 * HTTP statuses that represent EXPECTED client-side terminal states rather
 * than bugs, so the error boundary must not open a Sentry issue for them:
 *
 * - `403` — permission denied / an expired or already-consumed claim
 *   (e.g. "This scan can no longer be updated" on an expired QR claim).
 * - `404` — the resource genuinely does not exist.
 * - `429` — rate limited (e.g. `appLoaderRateLimit`'s per-(user, path) cap
 *   on `.data` revalidations). Transient by design — the client is expected
 *   to hit this occasionally, not a bug to triage.
 *
 * All OTHER 4xx (400/409/422, …) and every 5xx stay captured — those can
 * indicate real client/server problems worth triaging.
 */
export const EXPECTED_ERROR_BOUNDARY_STATUSES = [403, 404, 429] as const;

/**
 * Whether a status is an expected error-boundary terminal state that must not
 * be captured to Sentry. Accepts an already-parsed number; call sites that
 * hold the status as a string/tag should coerce with `Number(...)` first
 * (a `NaN` from a missing tag is correctly treated as "not expected").
 *
 * @param status - The HTTP status code (or `NaN`/`undefined` when unknown)
 * @returns `true` only for the expected statuses (403, 404, 429)
 */
export function isExpectedErrorBoundaryStatus(
  status: number | undefined
): boolean {
  return (
    status !== undefined &&
    (EXPECTED_ERROR_BOUNDARY_STATUSES as readonly number[]).includes(status)
  );
}

/** A single serialized exception entry within a Sentry error event. */
type SentryExceptionValue = NonNullable<
  NonNullable<ErrorEvent["exception"]>["values"]
>[number];

/**
 * An error message that is only an HTTP gateway status, optionally followed by
 * its reason phrase: 502, 503 and 504, plus Cloudflare's 520 to 524 (the origin
 * did not answer properly). React Router throws exactly this shape,
 * `${status} ${statusText}`, when its route manifest request (`/__manifest`)
 * gets a gateway error, and `statusText` is empty over HTTP/2.
 */
const GATEWAY_STATUS_PATTERN = /^5(?:0[234]|2[0-4])(?: [A-Za-z ]+)?$/;

/**
 * Whether an event is a gateway status error: its main exception is an
 * `Error` whose whole message is a gateway status (see
 * {@link GATEWAY_STATUS_PATTERN}). These are transient deploy and gateway
 * blips with nothing to fix in the app.
 *
 * Only the main exception counts. Sentry lists chained exceptions oldest
 * first, so it is the last entry; an error that merely has a gateway status
 * as its `cause` was raised by code that may have a bug of its own.
 *
 * Stack frames are not consulted: React Router is part of the client bundle,
 * so its throw carries bundle frames just like our own code would. No Shelf
 * code throws an error whose message is only a status code.
 *
 * @param event - The Sentry error event
 * @returns `true` when the event is a gateway status error
 */
function isGatewayStatusError(event: ErrorEvent): boolean {
  const main = event.exception?.values?.at(-1);
  return (
    main?.type === "Error" &&
    GATEWAY_STATUS_PATTERN.test((main.value ?? "").trim())
  );
}

/**
 * Whether an error message reports a JavaScript chunk that could not be
 * loaded, as opposed to an interrupted data request.
 *
 * @param message - The exception message
 * @returns `true` for module load failures in any supported browser
 */
function isModuleLoadFailure(message: string): boolean {
  return MODULE_LOAD_FAILURE_PATTERN.test(message);
}

/**
 * Whether an event is an unhandled promise rejection whose value is a React
 * Router route error response (a loader's `throw data(error(reason), { status
 * })`) carrying an EXPECTED status (403/404/429).
 *
 * Sentry cannot serialize a non-Error rejection, so it reports it as "Object
 * captured as promise rejection with keys: ..." and puts the object itself on
 * `extra.__serialized__`. React Router renders the same response through the
 * route's error boundary, where `isExpectedErrorBoundaryStatus` already keeps
 * it out of Sentry; this applies that policy to the rejection path too. Any
 * other status, and any rejection that is not a route error response, is kept.
 *
 * @param event - The Sentry error event
 * @returns `true` when the rejection is an expected route error response
 */
function isExpectedRouteErrorRejection(event: ErrorEvent): boolean {
  const isUnhandledRejection = event.exception?.values?.some(
    (v) => v.mechanism?.type?.includes("onunhandledrejection")
  );
  if (!isUnhandledRejection) {
    return false;
  }
  const value = event.extra?.__serialized__;
  if (!value || typeof value !== "object") {
    return false;
  }
  const { status, statusText, internal } = value as Record<string, unknown>;
  const isRouteErrorResponse =
    typeof status === "number" &&
    typeof statusText === "string" &&
    typeof internal === "boolean" &&
    "data" in value;
  return isRouteErrorResponse && isExpectedErrorBoundaryStatus(status);
}

/**
 * Matches errors from the script a crypto wallet injects into every page
 * (Brave's built-in wallet, MetaMask-style extensions), which sets
 * `window.ethereum.selectedAddress` before the wallet object exists. Safari
 * words it "evaluating 'window.ethereum.selectedAddress = undefined'",
 * Chromium "Cannot set properties of undefined (setting 'selectedAddress')".
 * Shelf never touches `window.ethereum`, so neither phrase comes from app code.
 */
const WALLET_INJECTION_PATTERN = /window\.ethereum|'selectedAddress'/;

/**
 * Path every file of the client bundle is served under (`assetsDir` and the
 * chunk names in `vite.config.ts`). A stack frame whose URL contains it ran
 * Shelf's own code.
 */
const CLIENT_BUNDLE_PATH = "/file-assets/";

/**
 * Whether an exception has a stack frame from Shelf's own client bundle.
 *
 * Judged by the frame's URL, not `in_app`: the browser SDK sets `in_app: true`
 * on every frame it parses, so a script an extension injects into the page,
 * or an inline script, looks first-party by that flag.
 *
 * @param value - A serialized Sentry exception entry
 * @returns `true` when at least one frame comes from the client bundle
 */
function hasClientBundleFrame(value: SentryExceptionValue): boolean {
  return (
    value.stacktrace?.frames?.some((f) =>
      (f.filename ?? "").includes(CLIENT_BUNDLE_PATH)
    ) ?? false
  );
}

/**
 * Whether an event is a crypto wallet's injected script failing on the page
 * rather than an error in Shelf. Requires that no exception in the event has a
 * frame from the client bundle as well, so an error thrown or rethrown by our
 * own code is never dropped by its wording alone. An event holds several
 * exceptions when one is the cause of another.
 *
 * @param event - The Sentry error event
 * @returns `true` when the error comes from an injected wallet script
 */
function isWalletInjectionError(event: ErrorEvent): boolean {
  const values = event.exception?.values ?? [];
  return (
    values.some((v) => WALLET_INJECTION_PATTERN.test(v.value ?? "")) &&
    !values.some(hasClientBundleFrame)
  );
}

/**
 * Client `beforeSend` hook body: decides whether a captured browser error is
 * worth sending to Sentry. Returns the (unchanged) event to send it, or
 * `null` to drop it.
 *
 * Ordering matters: unconditional hard-filters for known-unactionable noise
 * run first, THEN the `source: "error-boundary"` allowlist (which forces
 * user-visible crashes through so their on-screen Error ID resolves in
 * Sentry), and finally the softer pattern filters.
 *
 * @param event - The Sentry error event produced on the browser
 * @returns The event to send, or `null` to drop it
 */
export function handleClientBeforeSend(event: ErrorEvent): ErrorEvent | null {
  const message = event.exception?.values?.[0]?.value || "";

  // Hard-filter browser/framework quirks that are not actionable even
  // when they bubble up through React Router's error boundary. These
  // are stream-decode races, React reconciliation aborts mid-navigation,
  // and browser-extension DOM mutation collisions — all known noise
  // with no app-side fix. Tradeoff: when one of these surfaces in the
  // UI, the displayed Error ID will not exist in Sentry. That is
  // acceptable here because the error itself is not actionable; the
  // user is told to retry, and Sentry would only collect duplicate
  // reports of the same untriageable race.
  const hardIgnoredPatterns = [
    "Unable to decode turbo-stream",
    "Error in input stream",
  ];
  if (hardIgnoredPatterns.some((pattern) => message.includes(pattern))) {
    return null;
  }

  // Same hard-filter for the NotFoundError variants from React DOM
  // reconciliation (`removeChild`/`insertBefore` on a non-child).
  // These reach the error boundary because they happen during commit.
  if (
    event.exception?.values?.some(
      (v) =>
        v.type === "NotFoundError" &&
        (v.value?.includes("removeChild") || v.value?.includes("insertBefore"))
    )
  ) {
    return null;
  }

  // Hard-filter `DataCloneError` ("The object can not be cloned.") unless the
  // client bundle threw it. structuredClone, postMessage and IndexedDB throw it
  // on a value they cannot copy, usually inside browser internals or an
  // extension script. One with a frame from our bundle is a fixable bug and
  // stays capturable (see hasClientBundleFrame for why `in_app` cannot tell).
  const values = event.exception?.values ?? [];
  if (
    values.some((v) => v.type === "DataCloneError") &&
    !values.some(hasClientBundleFrame)
  ) {
    return null;
  }

  // Hard-filter client-side network errors and aborted requests
  // regardless of source — they bubble up through React Router's error
  // boundary when a route loader's fetch is interrupted, but they are
  // *never* actionable from app code (user closed the tab, lost
  // connection, hit back, or the browser cancelled an in-flight load).
  // Same Error-ID tradeoff as the hard-filtered patterns above. Also
  // check `exception.type` for `AbortError` — Sentry serializes the
  // error name into `.type` separately from `.value` (the message),
  // and some AbortErrors arrive with empty/generic messages.
  //
  // A JavaScript chunk that fails to download is exempt: Chrome words it
  // "Failed to fetch dynamically imported module", but it means part of the
  // app is missing, not that a request was interrupted, and it is the only
  // trace a broken deploy or a blocking proxy leaves.
  if (
    !isModuleLoadFailure(message) &&
    (message.includes("Load failed") ||
      message.includes("Failed to fetch") ||
      message.includes("NetworkError") ||
      message.includes("fetch failed") ||
      message.includes("AbortError") ||
      message.includes("The operation was aborted") ||
      message.includes("Fetch is aborted") ||
      event.exception?.values?.some((v) => v.type === "AbortError"))
  ) {
    return null;
  }

  // Hard-filter gateway status errors (see isGatewayStatusError). Same
  // Error-ID tradeoff as the hard-filtered patterns above.
  if (isGatewayStatusError(event)) {
    return null;
  }

  // Hard-filter expected route error responses (403/404/429) that reach the
  // global unhandled-rejection handler instead of the error boundary. Same
  // policy as the boundary branch below (see isExpectedRouteErrorRejection).
  if (isExpectedRouteErrorRejection(event)) {
    return null;
  }

  // Hard-filter errors from a crypto wallet's injected script; they run in
  // the page but are not Shelf code (see isWalletInjectionError).
  if (isWalletInjectionError(event)) {
    return null;
  }

  // Hard-filter `<unknown>` messages: these carry no signal, and the
  // error-boundary path produces them when the failure has no
  // serializable shape (cross-origin script errors, etc.).
  if (message === "<unknown>") {
    return null;
  }

  // Always send remaining errors from the error boundary — these are
  // user-visible crashes that must be searchable by the Error ID shown
  // to the user. Sentry.captureException() returns the event ID
  // synchronously before beforeSend runs, so filtering past this point
  // would silently drop the event while the UI still displays the
  // (now-orphaned) Error ID.
  if (event.tags?.source === "error-boundary") {
    // Defense-in-depth for EXPECTED terminal states (403/404): the capture
    // site already skips calling captureException for these, but if a
    // boundary event is ever tagged with an expected status, drop it here
    // too so it never opens an issue. Boundary events with no `status` tag
    // (client-side JS crashes) coerce to `NaN` and pass through unchanged.
    const status = Number(event.tags?.status);
    if (isExpectedErrorBoundaryStatus(status)) {
      return null;
    }
    return event;
  }

  // Filter browser compatibility / extension errors (not actionable).
  // "Expected fetcher: " and "No result found for routeId" are React
  // Router internal races during navigation. "Cannot submit a <button>"
  // is a fetcher.submit edge case from React Router's form helper.
  const ignoredPatterns = [
    "feature named",
    "Unexpected identifier 'https'",
    "Expected fetcher: ",
    "No result found for routeId",
    "Cannot submit a <button>",
  ];
  if (ignoredPatterns.some((pattern) => message.includes(pattern))) {
    return null;
  }

  // Filter non-Error promise rejections with value: false
  if (message === "false") {
    return null;
  }

  return event;
}
