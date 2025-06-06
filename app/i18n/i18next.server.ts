import type { EntryContext } from "@remix-run/node";
import type { TFunction } from "i18next";
import { createInstance } from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import { RemixI18Next } from "remix-i18next/server";
import i18n from "~/i18n/i18n";
import i18next from "~/i18n/i18next.server";
import { getLng } from "~/utils/cookies.server";
import en from "../../public/locales/en/common";
import fr from "../../public/locales/fr/common";

let RemixI18next = new RemixI18Next({
  detection: {
    supportedLanguages: i18n.supportedLngs,
    fallbackLanguage: i18n.fallbackLng,
  },
  i18next: {
    ...i18n,
    resources: { en: { common: en }, fr: { common: fr } },
  },
});

export async function createI18nInstance(
  request: Request,
  remixContext: EntryContext
) {
  const instance = createInstance();
  const ns = RemixI18next.getRouteNamespaces(remixContext);
  const lng = getLng(request);

  await instance
    .use(initReactI18next)
    .use(LanguageDetector)
    .init({
      ...i18n,
      ns,
      lng,
      resources: { en: { common: en }, fr: { common: fr } },
    });

  return instance;
}

export async function initTranslationLoader(
  request: Request
): Promise<TFunction> {
  let lng = getLng(request);
  let t = await i18next.getFixedT(lng);

  return t;
}

export default RemixI18next;
