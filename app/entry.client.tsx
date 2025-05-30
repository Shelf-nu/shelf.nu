import React from "react";

import { RemixBrowser } from "@remix-run/react";
import i18next from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { Provider as JotaiProvider } from "jotai";
import { hydrateRoot } from "react-dom/client";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { getInitialNamespaces } from "remix-i18next/client";
import i18n from "./i18n/i18n";
async function hydrate() {
  await i18next
    .use(initReactI18next)
    .use(LanguageDetector)
    .init({
      ...i18n,
      ns: getInitialNamespaces(),
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
