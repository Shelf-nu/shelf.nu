import { config } from "~/config/shelf.config";

// Client-side i18n configuration (no fs-backend)
export default {
  // This is the list of languages your application supports
  supportedLngs: config.SUPPORTED_LANGUAGES,
  // This is the language you want to use in case
  // if the user language is not in the supportedLngs
  fallbackLng: config.FALLBACK_LANGUAGE,
  // The default namespace of i18next is "translation", but you can customize it here
  defaultNS: "common",
  backend: {
    loadPath: "/locales/{{lng}}/{{ns}}.json",
  },
  // No plugins array - backends are added dynamically
};
