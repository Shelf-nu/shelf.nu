import { PassThrough } from "stream";

import { createReadableStreamFromReadable } from "@remix-run/node";
import type {
  ActionFunctionArgs,
  EntryContext,
  LoaderFunctionArgs,
} from "@remix-run/node";
import { RemixServer } from "@remix-run/react";
import * as Sentry from "@sentry/remix";
import isbot from "isbot";
import { renderToPipeableStream } from "react-dom/server";
import { registerBookingWorkers } from "./modules/booking";
import { SENTRY_DSN } from "./utils";
import * as schedulerService from "./utils/scheduler.server";

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    tracesSampleRate: 1,
  });
}
// === start: register scheduler and workers ===
schedulerService
  .init()
  .then(() => {
    registerBookingWorkers();
  })
  .finally(() => {
    // eslint-disable-next-line no-console
    console.log("Scheduler and workers registration completed");
  })
  // eslint-disable-next-line no-console
  .catch((e) => console.error(e));
// === end: register scheduler and workers ===

export function handleError(
  error: unknown,
  { request }: LoaderFunctionArgs | ActionFunctionArgs
) {
  if (Sentry) {
    Sentry.captureRemixServerException(error, "remix.server", request);
  }
}

const ABORT_DELAY = 5000;

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext
) {
  const callbackName = isbot(request.headers.get("user-agent"))
    ? "onAllReady"
    : "onShellReady";

  return new Promise(async (res, reject) => {
    let didError = false;

    const { pipe, abort } = renderToPipeableStream(
      <RemixServer context={remixContext} url={request.url} />,
      {
        [callbackName]() {
          const body = new PassThrough();

          responseHeaders.set("Content-Type", "text/html");

          res(
            new Response(createReadableStreamFromReadable(body), {
              status: didError ? 500 : responseStatusCode,
              headers: responseHeaders,
            })
          );
          pipe(body);
        },
        onShellError(err: unknown) {
          reject(err);
        },
        onError(error: unknown) {
          didError = true;
          // eslint-disable-next-line no-console
          console.error(error);
        },
      }
    );
    setTimeout(abort, ABORT_DELAY);
  });
}
