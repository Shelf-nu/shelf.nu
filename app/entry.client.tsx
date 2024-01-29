import React from "react";

import { RemixBrowser } from "@remix-run/react";
import { Provider as JotaiProvider } from "jotai";
import { hydrateRoot } from "react-dom/client";

function hydrate() {
  React.startTransition(() => {
    hydrateRoot(
      document,
      <React.StrictMode>
        <JotaiProvider>
          <RemixBrowser />
        </JotaiProvider>
      </React.StrictMode>
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
