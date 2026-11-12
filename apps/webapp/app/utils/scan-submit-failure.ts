/**
 * Keeps a scanner on screen when its save never gets an answer.
 *
 * A scanner's list lives in the page. When the save request fails in transit
 * (a gateway cuts it off, the server is unreachable, the connection drops),
 * React Router has no action result to hand back, so it throws to the nearest
 * error boundary and the page, with every scan on it, is replaced.
 *
 * {@link keepScanListOnSubmitFailure} is a `clientAction` that catches exactly
 * that case and returns it as action data instead, so the route stays mounted
 * and the drawer can say what happened. Refusals the server answers itself
 * (`data(error(...))`) already come back as action data and pass through
 * untouched.
 *
 * A request that failed in transit says nothing about whether the server
 * finished the work: a gateway gives up on the response, not on the request.
 * The result therefore never claims the save failed, only that it could not be
 * confirmed.
 *
 * @see {@link file://./../components/scanner/drawer/scan-submit-failure-alert.tsx}
 */
import { data, isRouteErrorResponse } from "react-router";

/** Why a scanner save has no answer. */
export type ScanSubmitFailureKind =
  /** A gateway or proxy stopped waiting for the server. */
  | "timeout"
  /** The server, or something in front of it, answered with a failure. */
  | "server"
  /** The request never completed: no connection, or it dropped mid-flight. */
  | "network";

/** A scanner save whose outcome is unknown. */
export type ScanSubmitFailure = {
  kind: ScanSubmitFailureKind;
  /** The HTTP status that came back, or `null` when nothing did. */
  status: number | null;
};

/** Action data returned in place of a thrown transport failure. */
export type ScanSubmitFailureData = {
  scanSubmitFailure: ScanSubmitFailure;
};

/**
 * Statuses that mean "nobody waited long enough", as opposed to "the server
 * broke": request timeout, gateway timeout, and Cloudflare's connection and
 * origin timeouts.
 */
const TIMEOUT_STATUSES = new Set([408, 504, 522, 524]);

/**
 * What browsers say when `fetch` cannot complete a request: "Failed to fetch"
 * (Chromium), "NetworkError when attempting to fetch resource." (Firefox),
 * "Load failed" (Safari).
 */
const FETCH_FAILURE = /failed to fetch|networkerror|load failed/i;

/**
 * Status reported to the router when no response arrived at all. Any value of
 * 400 or above tells React Router not to revalidate, see
 * {@link keepScanListOnSubmitFailure}.
 */
const NO_RESPONSE_STATUS = 503;

/**
 * Decides whether a value thrown by a scanner's save is a transport failure
 * the page should survive.
 *
 * Only failures with no usable answer qualify: a 5xx (or 408) response that
 * did not come from this app (its body is a gateway's page, not the app's
 * error payload), a `fetch` that rejected, or a response body that could not
 * be decoded. Everything else is returned as `null` so the
 * caller rethrows it: redirects, an aborted navigation, and 4xx responses,
 * which mean the session or the route is gone and the error page is the right
 * place to land.
 *
 * @param thrown - Whatever `serverAction()` rejected with
 * @returns The failure to show, or `null` when the value must be rethrown
 */
export function classifyScanSubmitFailure(
  thrown: unknown
): ScanSubmitFailure | null {
  if (isRouteErrorResponse(thrown)) {
    // A response this app produced carries its own structured error. That is
    // an answer, with a message of its own, and belongs to the error boundary.
    // A gateway's or proxy's page arrives as plain text.
    if (typeof thrown.data !== "string") {
      return null;
    }
    if (TIMEOUT_STATUSES.has(thrown.status)) {
      return { kind: "timeout", status: thrown.status };
    }
    if (thrown.status >= 500) {
      return { kind: "server", status: thrown.status };
    }
    return null;
  }

  if (thrown instanceof Response) {
    return null;
  }

  if (thrown instanceof Error) {
    // A navigation the user (or the router) interrupted is not a failed save.
    if (thrown.name === "AbortError") {
      return null;
    }
    // `fetch` rejects with a TypeError when the request cannot complete. The
    // message is checked as well, so a TypeError from a programming mistake
    // still reaches the error boundary instead of reading as a bad connection.
    if (thrown instanceof TypeError && FETCH_FAILURE.test(thrown.message)) {
      return { kind: "network", status: null };
    }
    // React Router's own message for a 2xx body it could not read, which is
    // what a proxy's HTML error page served with a success status looks like.
    if (thrown.message === "Unable to decode turbo-stream response") {
      return { kind: "server", status: null };
    }
  }

  return null;
}

/**
 * Reads the transport failure out of a route's action data, if that is what
 * the data is.
 *
 * @param actionData - The value of `useActionData()`
 * @returns The failure, or `null` for any other action result
 */
export function getScanSubmitFailure(
  actionData: unknown
): ScanSubmitFailure | null {
  if (
    typeof actionData !== "object" ||
    actionData === null ||
    !("scanSubmitFailure" in actionData)
  ) {
    return null;
  }
  const failure = (actionData as ScanSubmitFailureData).scanSubmitFailure;
  return failure && typeof failure.kind === "string" ? failure : null;
}

/**
 * `clientAction` for scanner routes: runs the server action and turns a
 * transport failure into action data, so the scanner and its list stay on
 * screen.
 *
 * The data is returned with an error status on purpose. React Router skips
 * revalidation after an action that answers 4xx or 5xx, and a revalidation
 * sent to a server that just failed to answer would most likely fail the same
 * way and replace the page after all.
 *
 * Export it from a scanner route as
 * `export const clientAction = keepScanListOnSubmitFailure;`. The shared
 * scanner drawer renders the message.
 *
 * @param args.serverAction - Calls the route's server `action`
 * @returns The server action's own result, or {@link ScanSubmitFailureData}
 * @throws Whatever the server action threw, when it is not a transport failure
 */
export async function keepScanListOnSubmitFailure({
  serverAction,
}: {
  serverAction: () => Promise<unknown>;
}) {
  try {
    return await serverAction();
  } catch (thrown) {
    const failure = classifyScanSubmitFailure(thrown);
    if (!failure) {
      throw thrown;
    }
    return data<ScanSubmitFailureData>(
      { scanSubmitFailure: failure },
      { status: failure.status ?? NO_RESPONSE_STATUS }
    );
  }
}
