import React from "react";

import * as Sentry from "@sentry/react-router";
import { Provider as JotaiProvider } from "jotai";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

if (window.env?.SENTRY_DSN) {
  Sentry.init({
    dsn: window.env.SENTRY_DSN,
    tunnel: "/api/sentry-tunnel",
    integrations: [Sentry.reactRouterTracingIntegration()],
    tracesSampleRate: 0.1,
    beforeSendTransaction(event) {
      const spans = event.spans || [];

      // Suppress N+1 for asset image refresh — server-side batch handles this;
      // client-side individual calls are an intentional safety net
      const imageRefreshSpans = spans.filter(
        (s) => s.description?.includes("/api/asset/refresh-main-image")
      );
      if (imageRefreshSpans.length > 3) {
        return null;
      }

      // Suppress React Router internal manifest fetching — framework behavior
      const manifestSpans = spans.filter(
        (s) => s.description?.includes("/__manifest")
      );
      if (manifestSpans.length > 3) {
        return null;
      }

      // Suppress consecutive HTTP on /assets/new. The route inherently
      // chains form submit + revalidation + image upload across multiple
      // HTTP spans, which Sentry's perf detector groups as
      // `performance_consecutive_http`. Drop any transaction on this route
      // that includes the form-data submit span — the previous threshold
      // (`> 1` matching spans) was too narrow and let most events through.
      if (event.transaction === "/assets/new") {
        const hasAssetNewDataSpan = spans.some(
          (s) => s.description?.includes("/assets/new.data")
        );
        if (hasAssetNewDataSpan) {
          return null;
        }
      }

      return event;
    },
    beforeSend(event) {
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
            (v.value?.includes("removeChild") ||
              v.value?.includes("insertBefore"))
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
    },
  });
}

React.startTransition(() => {
  hydrateRoot(
    document,
    <React.StrictMode>
      <JotaiProvider>
        <HydratedRouter />
      </JotaiProvider>
    </React.StrictMode>,
    {
      onRecoverableError(error, errorInfo) {
        if (window.env?.SENTRY_DSN) {
          Sentry.captureException(error, {
            extra: { componentStack: errorInfo.componentStack },
          });
        }
      },
    }
  );
});
