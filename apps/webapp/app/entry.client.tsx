import React from "react";

import * as Sentry from "@sentry/react-router";
import { Provider as JotaiProvider } from "jotai";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

import { handleClientBeforeSend } from "~/utils/sentry-filters";

if (window.env?.SENTRY_DSN) {
  Sentry.init({
    dsn: window.env.SENTRY_DSN,
    // Match the server release so before/after comparisons and source-map
    // resolution work end-to-end. Empty string when SENTRY_RELEASE /
    // FLY_RELEASE_VERSION aren't set (local dev).
    release: window.env.SENTRY_RELEASE || undefined,
    environment: window.env.NODE_ENV,
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
    // Drop/keep rules live in `handleClientBeforeSend` (a pure, unit-tested
    // function) so they can be exercised without hydrating this entry module.
    beforeSend: handleClientBeforeSend,
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
