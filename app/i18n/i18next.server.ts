import type { EntryContext } from "@remix-run/node";
import type { TFunction } from "i18next";
import { createInstance } from "i18next";
import Backend from "i18next-fs-backend";
import { initReactI18next } from "react-i18next";
import { RemixI18Next } from "remix-i18next/server";
import i18nConfig from "~/i18n/i18n"; // Your shared i18n config
import { getLng } from "~/utils/cookies.server";

// Create RemixI18next instance using JSON files (not TS)
const remixI18n = new RemixI18Next({
  detection: {
    supportedLanguages: i18nConfig.supportedLngs,
    fallbackLanguage: i18nConfig.fallbackLng,
  },
  i18next: {
    ...i18nConfig,
  },
  plugins: [Backend],
});

export async function createI18nInstance(
  request: Request,
  remixContext: EntryContext
) {
  const instance = createInstance();
  const ns = remixI18n.getRouteNamespaces(remixContext);
  const lng = getLng(request);
  await instance
    .use(initReactI18next)
    .use(Backend)
    .init({
      ...i18nConfig,
      ns,
      lng,
      detection: {
        order: ["htmlTag", "cookie"],
        lookupCookie: "i18next",
      },
      debug: process.env.NODE_ENV === "development",
    });

  return instance;
}

export async function initTranslationLoader(
  request: Request
): Promise<TFunction> {
  const lng = getLng(request);
  return remixI18n.getFixedT(lng);
}

export default remixI18n;
