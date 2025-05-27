import { RemixI18Next } from "remix-i18next/server";
import i18n from "~/i18n/i18n"; // your i18n configuration file
import { en } from "../../public/locales/en/common";
import { fr } from "../../public/locales/fr/common";
let i18next = new RemixI18Next({
  detection: {
    supportedLanguages: i18n.supportedLngs,
    fallbackLanguage: i18n.fallbackLng,
  },
  // This is the configuration for i18next used
  // when translating messages server-side only
  i18next: {
    ...i18n,
    resources: { en: { common: en }, fr: { common: fr } }, // You can add more languages here
  },
  // The i18next plugins you want RemixI18next to use for `i18n.getFixedT` inside loaders and actions.
  // E.g. The Backend plugin for loading translations from the file system
  // Tip: You could pass `resources` to the `i18next` configuration and avoid a backend here
});

export default i18next;
