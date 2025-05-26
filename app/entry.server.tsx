/* eslint-disable no-console */
import { resolve } from "node:path";
import { PassThrough } from "stream";

import type { AppLoadContext, EntryContext} from "@remix-run/node";
import { createReadableStreamFromReadable} from "@remix-run/node";
import { RemixServer } from "@remix-run/react";
import * as Sentry from "@sentry/remix";
import { createInstance } from "i18next";
import LanguageDetector from 'i18next-browser-languagedetector';
import Backend from "i18next-fs-backend";
import { isbot } from "isbot";
import { renderToPipeableStream } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { registerEmailWorkers } from "./emails/email.worker.server";
import i18n from "./i18n"; // your i18n configuration file
import i18next from "./i18next.server";
import { regierAssetWorkers } from "./modules/asset-reminder/worker.server";
import { registerBookingWorkers } from "./modules/booking/worker.server";
import { ShelfError } from "./utils/error";
import { Logger } from "./utils/logger";
import * as schedulerService from "./utils/scheduler.server";
export * from "../server";

// === start: register scheduler and workers ===
schedulerService
  .init()
  .then(async () => {
    await registerBookingWorkers().catch((cause) => {
      Logger.error(
        new ShelfError({
          cause,
          message: "Something went wrong while registering booking workers.",
          label: "Scheduler",
        })
      );
    });

    await regierAssetWorkers().catch((cause) => {
      Logger.error(
        new ShelfError({
          cause,
          message: "Something went wrong while registering asset workers.",
          label: "Scheduler",
        })
      );
    });

    await registerEmailWorkers().catch((cause) => {
      Logger.error(
        new ShelfError({
          cause,
          message: "Something went wrong while registering email workers.",
          label: "Scheduler",
        })
      );
    });
  })
  .finally(() => {
    // eslint-disable-next-line no-console
    console.log("Scheduler and workers registration completed");
  })
  .catch((cause) => {
    Logger.error(
      new ShelfError({
        cause,
        message: "Scheduler crash",
        label: "Scheduler",
      })
    );
  });
// === end: register scheduler and workers ===

/**
 * Handle errors that are not handled by a loader or action try/catch block.
 *
 * If this happen, you will have Sentry logs with a `Unhandled` tag and `unhandled.remix.server` as origin.
 *
 */
export const handleError = Sentry.wrapHandleErrorWithSentry;

const ABORT_DELAY = 5000;

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext,
  // This is ignored so we can keep it in the template for visibility.  Feel
  // free to delete this parameter in your app if you're not using it!
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  loadContext: AppLoadContext
) {
  // Determine callback based on user agent (bot vs browser)
  let callbackName = isbot(request.headers.get("user-agent"))
    ? "onAllReady"
    : "onShellReady";

  // Initialize i18n instance
  let instance = createInstance();
  let lng = await i18next.getLocale(request);
  let ns = i18next.getRouteNamespaces(remixContext);
  
  await instance
    .use(initReactI18next) // Tell our instance to use react-i18next
    .use(LanguageDetector)
    .use(Backend) // Setup our backend
    .init({
      detection: {
        order: ["cookie", "subdomain", "htmlTag"],
        lookupCookie: "i18next",
      },
      ...i18n, // spread the configuration
      lng, // The locale we detected above
      ns, // The namespaces the routes about to render wants to use
      backend: { loadPath: resolve("./public/locales/{{lng}}/{{ns}}.json") },
    });

  return new Promise((resolve, reject) => {
    let didError = false;
    const { pipe, abort } = renderToPipeableStream(
      <I18nextProvider i18n={instance}>
        <RemixServer
          context={remixContext}
          url={request.url}
          abortDelay={ABORT_DELAY}
        />
      </I18nextProvider>,
      {
        [callbackName]: () => {
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");

          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: didError ? 500 : responseStatusCode,
            })
          );

          pipe(body);
        },
        onShellError(error: unknown) {
          reject(error);
        },
        onError(error: unknown) {
          didError = true;
          responseStatusCode = 500;
          console.error(error);
        },
      }
    );

    setTimeout(abort, ABORT_DELAY);
  });
}