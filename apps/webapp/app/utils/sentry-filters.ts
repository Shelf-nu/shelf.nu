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

/**
 * HTTP statuses that represent EXPECTED client-side terminal states rather
 * than bugs, so the error boundary must not open a Sentry issue for them:
 *
 * - `403` — permission denied / an expired or already-consumed claim
 *   (e.g. "This scan can no longer be updated" on an expired QR claim).
 * - `404` — the resource genuinely does not exist.
 *
 * All OTHER 4xx (400/409/422/429, …) and every 5xx stay captured — those can
 * indicate real client/server problems worth triaging.
 */
export const EXPECTED_ERROR_BOUNDARY_STATUSES = [403, 404] as const;

/**
 * Whether a status is an expected error-boundary terminal state that must not
 * be captured to Sentry. Accepts an already-parsed number; call sites that
 * hold the status as a string/tag should coerce with `Number(...)` first
 * (a `NaN` from a missing tag is correctly treated as "not expected").
 *
 * @param status - The HTTP status code (or `NaN`/`undefined` when unknown)
 * @returns `true` only for the expected statuses (403, 404)
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
 * Whether an exception value has NO first-party (`in_app`) stack frame — i.e.
 * no application-code origin we could act on.
 *
 * Noise filters use this to stay narrow: an error thrown by OUR code carries
 * `in_app` frames (it identifies a fixable bug and its on-screen Error ID must
 * stay resolvable in Sentry), whereas the browser/extension/gateway noise we
 * want to drop has no first-party origin.
 *
 * @param value - A serialized Sentry exception entry
 * @returns `true` when none of its frames are first-party
 */
function hasNoFirstPartyFrame(value: SentryExceptionValue): boolean {
  return !(value.stacktrace?.frames?.some((f) => f.in_app === true) ?? false);
}

/**
 * Bare 3-digit gateway codes (502/503/504) that show up as an error `value`
 * with no JS origin — transient deploy/gateway blips, not app bugs.
 */
const BARE_GATEWAY_STATUS_PATTERN = /^50[234]$/;

/**
 * True for a "bare gateway status" Error: an `Error` whose entire message is
 * a 5xx gateway code (502/503/504) AND which carries no first-party
 * (`in_app`) stack frames. Those are transient gateway/deploy blips surfaced
 * to the browser with no first-party origin.
 *
 * The no-`in_app`-frames guard is deliberate and keeps the match narrow: a
 * genuine `throw new Error("502")` from our own code would carry first-party
 * frames and therefore stays capturable. Only origin-less status blips are
 * dropped.
 *
 * @param event - The Sentry error event
 * @returns `true` when the event is a bare gateway-status blip
 */
function isBareGatewayStatusError(event: ErrorEvent): boolean {
  const values = event.exception?.values;
  if (!values || values.length === 0) {
    return false;
  }
  return values.some((v) => {
    if (v.type !== "Error") {
      return false;
    }
    const value = (v.value ?? "").trim();
    if (!BARE_GATEWAY_STATUS_PATTERN.test(value)) {
      return false;
    }
    // No first-party frames → no JS origin we could act on.
    return hasNoFirstPartyFrame(v);
  });
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

  // Hard-filter `DataCloneError` ("The object can not be cloned.") that has NO
  // first-party origin. Thrown by structuredClone / postMessage / IndexedDB on
  // a non-cloneable value — usually from browser internals or extensions.
  // Matched by the serialized error name (Sentry puts the constructor name in
  // `.type`). The no-first-party-frames guard keeps a DataCloneError thrown by
  // OUR code capturable: it flags a fixable bug and its on-screen Error ID must
  // stay resolvable in Sentry (see hasNoFirstPartyFrame).
  if (
    event.exception?.values?.some(
      (v) => v.type === "DataCloneError" && hasNoFirstPartyFrame(v)
    )
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
  if (
    message.includes("Load failed") ||
    message.includes("Failed to fetch") ||
    message.includes("NetworkError") ||
    message.includes("fetch failed") ||
    message.includes("AbortError") ||
    message.includes("The operation was aborted") ||
    message.includes("Fetch is aborted") ||
    event.exception?.values?.some((v) => v.type === "AbortError")
  ) {
    return null;
  }

  // Hard-filter bare gateway-status blips (`Error: 502` / `503` / `504` with
  // no first-party stack). Transient deploy/gateway hiccups with no JS
  // origin; a real `throw new Error("502")` from our code keeps its
  // first-party frames and is left capturable (see isBareGatewayStatusError).
  if (isBareGatewayStatusError(event)) {
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
