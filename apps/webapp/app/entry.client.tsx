import React from "react";

import * as Sentry from "@sentry/react-router";
import { Provider as JotaiProvider } from "jotai";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

if (window.env?.SENTRY_DSN) {
  Sentry.init({
    dsn: window.env.SENTRY_DSN,
    tracesSampleRate: 0.1,
  });
}

function hydrate() {
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
}

if (typeof requestIdleCallback === "function") {
  requestIdleCallback(hydrate);
} else {
  // Safari doesn't support requestIdleCallback
  // https://caniuse.com/requestidlecallback
  setTimeout(hydrate, 1);
}
