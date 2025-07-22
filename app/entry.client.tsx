import React from "react";

import { RemixBrowser } from "@remix-run/react";
import i18next from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import Backend from "i18next-http-backend";
import { Provider as JotaiProvider } from "jotai";
import { hydrateRoot } from "react-dom/client";
import { I18nextProvider, initReactI18next } from "react-i18next";
import i18n from "./i18n/i18n.client";

async function hydrate() {
  await i18next
    .use(initReactI18next)
    .use(Backend)
    .use(LanguageDetector)
    .init({
      ...i18n,
      debug: false, // Disable all i18next logging in production
    });
  
  React.startTransition(() => {
    hydrateRoot(
      document,
      <I18nextProvider i18n={i18next}>
        <React.StrictMode>
          <JotaiProvider>
            <RemixBrowser />
          </JotaiProvider>
        </React.StrictMode>
      </I18nextProvider>
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
