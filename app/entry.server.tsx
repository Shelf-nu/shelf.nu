/* eslint-disable no-console */
import { PassThrough } from "stream";

import { createReadableStreamFromReadable } from "@remix-run/node";
import type { AppLoadContext, EntryContext } from "@remix-run/node";
import { RemixServer } from "@remix-run/react";
import * as Sentry from "@sentry/remix";
import { isbot } from "isbot";
import { renderToPipeableStream } from "react-dom/server";
import { registerEmailWorkers } from "./emails/email.worker.server";
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

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext,
  // This is ignored so we can keep it in the template for visibility.  Feel
  // free to delete this parameter in your app if you're not using it!
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  loadContext: AppLoadContext
) {
  return isbot(request.headers.get("user-agent") || "")
    ? handleBotRequest(
        request,
        responseStatusCode,
        responseHeaders,
        remixContext
      )
    : handleBrowserRequest(
        request,
        responseStatusCode,
        responseHeaders,
        remixContext
      );
}

function handleBotRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext
) {
  return new Promise((resolve, reject) => {
    let shellRendered = false;
    const { pipe, abort } = renderToPipeableStream(
      <RemixServer
        context={remixContext}
        url={request.url}
        abortDelay={ABORT_DELAY}
      />,
      {
        onAllReady() {
          shellRendered = true;
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");

          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            })
          );

          pipe(body);
        },
        onShellError(error: unknown) {
          reject(error);
        },
        onError(error: unknown) {
          responseStatusCode = 500;
          // Log streaming rendering errors from inside the shell.  Don't log
          // errors encountered during initial shell rendering since they'll
          // reject and get logged in handleDocumentRequest.
          if (shellRendered) {
            console.error(error);
          }
        },
      }
    );

    setTimeout(abort, ABORT_DELAY);
  });
}

function handleBrowserRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext
) {
  return new Promise((resolve, reject) => {
    let shellRendered = false;
    const { pipe, abort } = renderToPipeableStream(
      <RemixServer
        context={remixContext}
        url={request.url}
        abortDelay={ABORT_DELAY}
      />,
      {
        onShellReady() {
          shellRendered = true;
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");

          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            })
          );

          pipe(body);
        },
        onShellError(error: unknown) {
          reject(error);
        },
        onError(error: unknown) {
          responseStatusCode = 500;
          // Log streaming rendering errors from inside the shell.  Don't log
          // errors encountered during initial shell rendering since they'll
          // reject and get logged in handleDocumentRequest.
          if (shellRendered) {
            console.error(error);
          }
        },
      }
    );

    setTimeout(abort, ABORT_DELAY);
  });
}
