import React from "react";

import { RemixBrowser } from "@remix-run/react";
import { Provider as JotaiProvider } from "jotai";
import { hydrateRoot } from "react-dom/client";
import { hydrateLang } from "remix-paraglidejs/client";
import { locales, setLocale } from "~/paraglide/runtime";
function hydrate() {
  React.startTransition(() => {
    const lang = hydrateLang("language-tag", locales);
    setLocale(lang);
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
