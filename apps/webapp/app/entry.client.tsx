import React from "react";

import { RemixBrowser } from "@remix-run/react";
import { hydrateRoot } from "react-dom/client";

import { I18nClientProvider, initI18nextClient } from "./integrations/i18n"; // your i18n configuration file

function hydrate() {
  React.startTransition(() => {
    hydrateRoot(
      document,
      <React.StrictMode>
        <I18nClientProvider>
          <RemixBrowser />
        </I18nClientProvider>
      </React.StrictMode>
    );
  });
}

initI18nextClient(hydrate);
