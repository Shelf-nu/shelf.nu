import { useEffect, useState } from "react";
import * as Sentry from "@sentry/react-router";
import { useLocation, useRouteError } from "react-router";

import { isRouteError } from "~/utils/http";
import { tw } from "~/utils/tw";
import Error404Handler from "./error-404-handler";
import { parse404ErrorData } from "./utils";
import { Button } from "../shared/button";

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

export const ErrorContent = ({ className }: ErrorContentProps) => {
  const loc = useLocation();
  const response = useRouteError();

  let title = "Oops, something went wrong";
  let message =
    "There was an unexpected error. Please refresh to try again. If the issues persists, please contact support.";
  let traceId;

  if (isRouteError(response)) {
    message = response.data.error.message;
    title = response.data.error.title || "Oops, something went wrong";
    traceId = response.data.error.traceId;
  }

  const error404 = parse404ErrorData(response);

  // Only capture unhandled Error instances client-side.
  // Route errors from ShelfError are already captured server-side via handleError.
  const [sentryEventId, setSentryEventId] = useState<string | null>(null);
  useEffect(() => {
    if (
      response instanceof Error &&
      !error404.isError404 &&
      window.env?.SENTRY_DSN
    ) {
      setSentryEventId(
        Sentry.captureException(response, {
          tags: { source: "error-boundary" },
        })
      );
    }
  }, [response, error404.isError404]);
  if (error404.isError404) {
    return (
      <Error404Handler
        className={className}
        additionalData={error404.additionalData}
      />
    );
  }

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
        {traceId && <p className="text-gray-400">(Trace id: {traceId})</p>}
        {sentryEventId && (
          <p className="text-gray-400">(Error ID: {sentryEventId})</p>
        )}
        <div className=" mt-8 flex gap-3">
          <Button to="/" variant="secondary" icon="home">
            Back to home
          </Button>
          <Button to={loc.pathname} reloadDocument>
            Reload page
          </Button>
        </div>
      </div>
    </div>
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
