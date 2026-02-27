import React from "react";

import { Provider as JotaiProvider } from "jotai";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

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
          // eslint-disable-next-line no-console
          console.error("Hydration error:", error);
          // eslint-disable-next-line no-console
          console.error("Component stack:", errorInfo.componentStack);
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
