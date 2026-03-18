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
    ignoreErrors: [
      // Browser compatibility / extension errors
      "feature named",
      "Unexpected identifier 'https'",
      "Unable to decode turbo-stream",
      "Error in input stream",
      /^false$/, // Non-Error promise rejection with value: false
    ],
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

      // Suppress consecutive HTTP on /assets/new — React Router form + revalidation
      if (event.transaction === "/assets/new") {
        const assetNewSpans = spans.filter(
          (s) => s.description?.includes("/assets/new.data")
        );
        if (assetNewSpans.length > 1) {
          return null;
        }
      }

      return event;
    },
    beforeSend(event) {
      const message = event.exception?.values?.[0]?.value || "";

      // Filter client-side network errors (not actionable)
      if (
        message.includes("Load failed") ||
        message.includes("Failed to fetch") ||
        message.includes("NetworkError") ||
        message.includes("fetch failed")
      ) {
        return null;
      }

      // Filter DOM errors from browser extensions (removeChild/insertBefore on non-child)
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

      // Filter unknown/empty error messages (no actionable info)
      if (message === "<unknown>") {
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
