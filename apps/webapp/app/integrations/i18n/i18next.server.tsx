import { resolve } from "node:path";

import type { EntryContext } from "@remix-run/node";
import { createInstance } from "i18next";
import Backend from "i18next-fs-backend";
import { initReactI18next } from "react-i18next";
import { RemixI18Next } from "remix-i18next";

import { config } from "./config"; // your i18n configuration file

export const i18nextServer = new RemixI18Next({
  detection: {
    supportedLanguages: config.supportedLngs,
    fallbackLanguage: config.fallbackLng,
  },
  // This is the configuration for i18next used
  // when translating messages server-side  only
  i18next: {
    ...config,
    backend: {
      loadPath: resolve("./public/locales/{{lng}}/{{ns}}.json"),
    },
  },
  // The backend you want to use to load the translations
  // Tip: You could pass `resources` to the `i18next` configuration and avoid
  // a backend here
  backend: Backend,
});

export async function createI18nextServerInstance(
  request: Request,
  remixContext: EntryContext
) {
  // Create a new instance of i18next so every request will have a
  // completely unique instance and not share any state
  const instance = createInstance();

  await instance
    .use(initReactI18next) // Tell our instance to use react-i18next
    .use(Backend) // Setup our backend
    .init({
      ...config, // spread the configuration
      lng: await i18nextServer.getLocale(request), // detect locale from the request
      ns: i18nextServer.getRouteNamespaces(remixContext), // detect what namespaces the routes about to render want to use
      backend: {
        loadPath: resolve("./public/locales/{{lng}}/{{ns}}.json"),
      },
    });

  return instance;
}
