import type { ReactNode } from "react";
import { Component, lazy, Suspense, useEffect, useState } from "react";
import * as Sentry from "@sentry/react-router";
import { isRouteErrorResponse, useLocation, useRouteError } from "react-router";

import { useUserData } from "~/hooks/use-user-data";
import { isRouteError } from "~/utils/http";
import { tw } from "~/utils/tw";
import Error404Handler from "./error-404-handler";
import { parse404ErrorData } from "./utils";
import { Button } from "../shared/button";

/* Lazy: root.tsx uses ErrorContent as the app-wide ErrorBoundary, so a
 * static import would pull the feedback modal (crisp-sdk-web, react-zorm,
 * the dialog) into the root chunk shipped to every visitor. The chunk only
 * loads when someone actually clicks "Report this issue". */
const FeedbackModal = lazy(() => import("../feedback/feedback-modal"));

/**
 * Catches a failed lazy-chunk load (or render crash) of the feedback modal.
 * ErrorContent already IS the app-wide error boundary, so anything escaping
 * from here would blank the whole error page; failing to load the report
 * dialog should degrade to hiding the report UI instead.
 */
class ReportModalBoundary extends Component<
  { onError: () => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onError();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

type ErrorContentProps = { className?: string };

/**
 * Splits a multi-line error message into objects with stable, cumulative-
 * offset ids so the rendered list has unique keys that don't depend on the
 * array index (satisfies react-doctor/no-array-index-as-key) and stays
 * stable across re-renders even if line content changes.
 */
function splitIntoStableLines(message: string) {
  let offset = 0;
  return message.split("\n").map((content) => {
    const id = `line-${offset}`;
    offset += content.length + 1;
    return { id, content };
  });
}

/**
 * Renders the "(Trace id: …)" line shown under the error message on both
 * the not-found and generic error screens. Renders nothing when no trace id
 * is available (e.g. a client-side crash that never reached the server).
 */
function TraceIdLine({ traceId }: { traceId?: string }) {
  if (!traceId) {
    return null;
  }
  return <p className="text-gray-400">(Trace id: {traceId})</p>;
}

/**
 * The "Back to home" action shared by the not-found and generic error
 * screens — factored out so both screens render the identical button
 * instead of duplicating its props.
 */
function BackHomeButton() {
  return (
    <Button to="/" variant="secondary" icon="home">
      Back to home
    </Button>
  );
}

type ErrorScreenLayoutProps = {
  className?: string;
  title: string;
  message: string;
  traceId?: string;
  /** Extra content rendered between the trace id line and the action
   * buttons — e.g. the Sentry event id line on the generic screen. */
  extra?: ReactNode;
  /** The screen's action buttons. Content differs per screen (the
   * not-found screen only offers "Back to home"; the generic screen also
   * offers Reload / Report), so the caller owns this slot. */
  actions: ReactNode;
};

/**
 * Shared centered "error screen" chrome — icon, heading, message body, and
 * trace id line — used by both the not-found screen and the generic
 * "something went wrong" screen so they don't duplicate this layout block.
 * Screen-specific content (extra info line, action buttons) is supplied by
 * the caller via `extra`/`actions`.
 */
function ErrorScreenLayout({
  className,
  title,
  message,
  traceId,
  extra,
  actions,
}: ErrorScreenLayoutProps) {
  // Preserve newlines as <br/> without injecting HTML: split the message on
  // "\n" and interleave <br/> elements between segments. Keeps the same
  // visual output as the previous dangerouslySetInnerHTML approach while
  // avoiding any raw HTML injection. Uses cumulative-offset ids so keys are
  // stable when the message text changes (not derived from the array index).
  const messageLines = splitIntoStableLines(message);

  return (
    <div
      className={tw(
        "flex size-full h-dvh items-center justify-center",
        className
      )}
    >
      <div className="flex flex-col items-center text-center">
        <span className="mb-5 size-14 text-primary">
          <ErrorIcon />
        </span>
        <h2 className="mb-2">{title}</h2>
        <p className="max-w-[550px]">
          {messageLines.map((line, i) => (
            <span key={line.id}>
              {i > 0 && <br />}
              {line.content}
            </span>
          ))}
        </p>
        <TraceIdLine traceId={traceId} />
        {extra}
        <div className="mt-8 flex gap-3">{actions}</div>
      </div>
    </div>
  );
}

/**
 * App-wide `ErrorBoundary` content, rendered by `root.tsx` and the
 * authenticated `_layout` route for any error that reaches a route
 * boundary. Branches into three screens:
 * - The benign workspace-switcher case (`<Error404Handler/>`): the resource
 *   exists but belongs to another of the user's organizations.
 * - A genuine 404 that is NOT the workspace-switcher shape: a calm
 *   "Not found" screen.
 * - Everything else: the generic "Oops, something went wrong" screen.
 *
 * Also captures failures to Sentry: unhandled client-side `Error` instances
 * (JS crashes), and route-error 4xx responses that aren't already captured
 * server-side (5xx is captured server-side by `handleError`/`error()`; the
 * workspace-switcher case is expected UX, not a bug, so it's never
 * captured).
 */
export const ErrorContent = ({ className }: ErrorContentProps) => {
  const loc = useLocation();
  const response = useRouteError();

  /* Present when the authenticated app layout rendered (child-route errors).
   * That is also the only case where /api/feedback can accept a report, so
   * the "Report this issue" button is gated on it. */
  const user = useUserData();
  const [reportOpen, setReportOpen] = useState(false);
  /* Flipped when the modal chunk fails to load/render: the report UI hides
   * instead of leaving a button that blanks the page when clicked */
  const [reportBroken, setReportBroken] = useState(false);

  // `rawTitle` is the error's own title, if any, BEFORE either screen's
  // fallback is applied — the not-found screen falls back to "Not found",
  // the generic screen falls back to "Oops, something went wrong".
  let rawTitle: string | undefined;
  let title = "Oops, something went wrong";
  let message =
    "There was an unexpected error. Please refresh to try again. If the issues persists, please contact support.";
  let traceId: string | undefined;
  let errorLabel: string | undefined;
  let errorStatus: string | undefined;
  let statusCode: number | undefined;

  if (isRouteErrorResponse(response)) {
    statusCode = response.status;
    errorStatus = String(response.status);
  }

  if (isRouteError(response)) {
    message = response.data.error.message;
    rawTitle = response.data.error.title;
    title = rawTitle || "Oops, something went wrong";
    traceId = response.data.error.traceId;
    errorLabel = response.data.error.label;
  }

  /* For client-side crashes the rendered message is a generic fallback, so
   * attach the real error message to the report instead */
  const reportErrorMessage =
    response instanceof Error ? response.message : message;

  const error404 = parse404ErrorData(response);

  /**
   * A genuine "resource not found": a route-error response with HTTP 404
   * that is NOT the workspace-switcher shape (that shape renders
   * `<Error404Handler/>` below with its own "switch workspace?" UX instead
   * of this calmer not-found screen).
   */
  const isNotFound =
    isRouteError(response) && !error404.isError404 && statusCode === 404;

  /**
   * Route-error responses in the 4xx range (bad input, permission denials,
   * genuine not-found, …) that reach this boundary are NOT already captured
   * server-side — `error()` in http.server.ts only routes 5xx (and
   * uncaught errors) to Sentry via `Logger.error`; handled 4xx land on the
   * low-severity log trail instead. Capture them here so they're findable
   * by the same trace id shown to the user. 5xx is excluded (already
   * captured server-side — capturing again here would double-report), and
   * the benign workspace-switcher case is excluded entirely (expected
   * cross-org UX, not a bug).
   */
  const shouldCaptureRouteError =
    isRouteError(response) &&
    !error404.isError404 &&
    statusCode !== undefined &&
    statusCode >= 400 &&
    statusCode < 500;

  // Capture unhandled Error instances (client-side crashes) client-side,
  // and capturable 4xx route errors (see shouldCaptureRouteError above).
  // Route errors that are 5xx are already captured server-side via
  // handleError, so they're deliberately left uncaptured here.
  const [sentryEventId, setSentryEventId] = useState<string | null>(null);
  useEffect(() => {
    if (!window.env?.SENTRY_DSN) {
      return;
    }

    if (response instanceof Error && !error404.isError404) {
      setSentryEventId(
        Sentry.captureException(response, {
          tags: { source: "error-boundary" },
        })
      );
      return;
    }

    if (shouldCaptureRouteError) {
      // Synthetic Error (rather than `response`, which is a plain
      // route-error data object here, not an Error instance) so Sentry
      // groups the issue sensibly by message, like any other captured
      // exception. Not stored in `sentryEventId`: the route-error path
      // shows the shelf trace id to the user, not the Sentry event id.
      Sentry.captureException(new Error(message), {
        tags: {
          source: "error-boundary",
          shelf_trace_id: traceId,
          label: errorLabel,
          status: errorStatus,
        },
        contexts: { route: { pathname: loc.pathname } },
      });
    }
  }, [
    response,
    error404.isError404,
    shouldCaptureRouteError,
    message,
    traceId,
    errorLabel,
    errorStatus,
    loc.pathname,
  ]);

  if (error404.isError404) {
    return (
      <Error404Handler
        className={className}
        additionalData={error404.additionalData}
      />
    );
  }

  if (isNotFound) {
    return (
      <ErrorScreenLayout
        className={className}
        title={rawTitle || "Not found"}
        message={message}
        traceId={traceId}
        actions={<BackHomeButton />}
      />
    );
  }

  return (
    <>
      <ErrorScreenLayout
        className={className}
        title={title}
        message={message}
        traceId={traceId}
        extra={
          sentryEventId ? (
            <p className="text-gray-400">(Error ID: {sentryEventId})</p>
          ) : null
        }
        actions={
          <>
            <BackHomeButton />
            <Button to={loc.pathname} reloadDocument>
              Reload page
            </Button>
            {user && !reportBroken ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setReportOpen(true)}
              >
                Report this issue
              </Button>
            ) : null}
          </>
        }
      />

      {/* Mounted only while open: keeps the modal's hooks/effects off
      every error render and resets its state on each reopen. Rendered as
      a Portal (see DialogPortal), so its position here relative to
      ErrorScreenLayout has no visual effect. */}
      {user && !reportBroken && reportOpen ? (
        <ReportModalBoundary
          onError={() => {
            setReportBroken(true);
            setReportOpen(false);
          }}
        >
          <Suspense fallback={null}>
            <FeedbackModal
              open={reportOpen}
              onClose={() => setReportOpen(false)}
              errorContext={{
                traceId,
                sentryEventId: sentryEventId ?? undefined,
                errorStatus,
                errorTitle: title,
                errorMessage: reportErrorMessage,
              }}
            />
          </Suspense>
        </ReportModalBoundary>
      ) : null}
    </>
  );
};

export const ErrorIcon = () => (
  <svg
    width="56px"
    height="56px"
    viewBox="0 0 56 56"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M56 0H0V56H56V0Z" fill="currentColor" />
    <rect x="11.9" y="25.375" width="4.2" height="18.375" fill="white" />
    <rect x="18.9" y="32.375" width="4.2" height="11.375" fill="white" />
    <rect x="25.9" y="25.375" width="4.2" height="18.375" fill="white" />
    <rect x="32.9" y="30.625" width="4.2" height="13.125" fill="white" />
    <rect x="39.9" y="25.375" width="4.2" height="18.375" fill="white" />
    <rect
      x="11.375"
      y="25.375"
      width="5.25"
      height="8.75"
      fill="currentColor"
    />
    <rect
      x="39.375"
      y="25.375"
      width="5.25"
      height="9.625"
      fill="currentColor"
    />
    <rect x="32" y="25" width="6" height="7" fill="currentColor" />
    <rect x="25" y="25" width="7" height="6" fill="currentColor" />
    <rect
      x="14"
      y="20.125"
      width="4.375"
      height="6.125"
      transform="rotate(-90 14 20.125)"
      fill="white"
    />
    <rect
      x="36.75"
      y="20.125"
      width="4.375"
      height="5.25"
      transform="rotate(-90 36.75 20.125)"
      fill="white"
    />
  </svg>
);
