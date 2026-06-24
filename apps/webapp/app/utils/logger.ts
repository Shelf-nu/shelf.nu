import * as Sentry from "@sentry/react-router";
import pino from "pino";

import { SENTRY_DSN, env } from "./env";
import { ShelfError } from "./error";

/**
 * Fraction of handled 4xx errors to record in the Sentry log trail. Defaults
 * to 1 (keep all — the 5GB logs quota is ample); dial down via
 * `SENTRY_HANDLED_4XX_SAMPLE_RATE` (0–1) without a deploy if 4xx volume ever
 * threatens the quota.
 *
 * Note: the recurring curl-pentester sweep is filtered at the Sentry project
 * level (an inbound/log filter on `browser.name:curl`), not here — the
 * user-agent isn't available at this emit point.
 */
const HANDLED_4XX_SAMPLE_RATE = (() => {
  // This module is reachable from the client bundle (e.g. the rich-text editor
  // imports Logger), and this IIFE runs at module-load time. In the browser
  // `process` is undefined in dev (Vite only statically replaces `process.env.X`
  // in production builds), so guard the access — the sample rate is a
  // server-only concern (handledClientError emits 4xx logs server-side) and
  // defaults to 1 when unavailable.
  const raw =
    typeof process !== "undefined"
      ? Number(process.env.SENTRY_HANDLED_4XX_SAMPLE_RATE)
      : NaN;
  return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 1;
})();

function serializeError<E extends Error>(error: E): Error {
  if (!(error.cause instanceof Error)) {
    return {
      ...error,
      stack: error.stack,
    };
  }

  return {
    ...error,
    cause: serializeError(error.cause),
    stack: error.stack,
  };
}

const logger = pino({
  level: "debug",
  serializers: {
    err: (cause) => {
      if (!(cause instanceof ShelfError)) {
        return pino.stdSerializers.err(cause);
      }
      return serializeError(cause);
    },
  },
});

/**
 * A simple logger abstraction that can be used to log messages in the console.
 *
 * You could interface with a logging service like Sentry or LogRocket here.
 */
export class Logger {
  static dev(...args: unknown[]) {
    if (env.NODE_ENV === "development") {
      logger.debug(args);
    }
  }
  static log(...args: unknown[]) {
    logger.info(args);
  }
  static warn(...args: unknown[]) {
    logger.warn(args);
  }
  static info(...args: unknown[]) {
    logger.info(args);
  }
  static error(error: unknown) {
    logger.error(error);

    if (SENTRY_DSN) {
      Sentry.captureException(error);
    }
  }

  /**
   * Record a handled client error (4xx) as a low-severity Sentry **log**
   * rather than an error event. Keeps a searchable trail of expected,
   * user-facing failures (validation, not-found, forbidden, business-rule
   * conflicts) without consuming the small error-event quota or alerting —
   * `handleBeforeSendError` drops these from the error pipeline, and they land
   * on the separate logs quota instead. No-op for anything that isn't a 4xx
   * `ShelfError`. A sampling rate caps volume so the trail can't be flooded.
   */
  static handledClientError(cause: ShelfError) {
    // 4xx only — client errors. Mirrors `isHandledClientError()` in ./error
    // (which the Sentry beforeSend hook uses to drop these from the error
    // pipeline). Inlined here, rather than imported, so this commonly-hit path
    // doesn't couple logger.ts to ./error's export surface — many tests fully
    // mock ~/utils/error and a new import would break them. ShelfError.status
    // defaults to 500, so a missing status is treated as a server error.
    const status = cause?.status ?? 500;
    if (!SENTRY_DSN || status < 400 || status >= 500) {
      return;
    }

    const userId =
      typeof cause.additionalData?.userId === "string"
        ? cause.additionalData.userId
        : undefined;

    // Sample to protect the logs quota (default keeps all).
    if (
      HANDLED_4XX_SAMPLE_RATE < 1 &&
      Math.random() >= HANDLED_4XX_SAMPLE_RATE
    ) {
      return;
    }

    Sentry.logger.info(cause.message, {
      label: cause.label,
      status: cause.status,
      traceId: cause.traceId,
      ...(userId ? { userId } : {}),
    });
  }
}

/**
 * A simple class to log the time it takes to process a request.
 *
 * @example
 * const requestTimeLogger = new RequestTimeLogger("MyRequest");
 * // ... do some work
 * requestTimeLogger.log(); // MyRequest took 123ms
 */
export class RequestTimeLogger {
  private readonly start: number;
  private readonly label: string;
  constructor(label: string) {
    this.start = Date.now();
    this.label = label;
  }

  log() {
    const end = Date.now();
    const duration = end - this.start;
    Logger.log(`${this.label} took ${duration}ms`);
  }
}

/**
 * Log the full context when a form submission reaches the server without the expected `intent` field.
 *
 * Excludes sensitive headers (cookies/authorization) but preserves all other request metadata and the form payload so we
 * can diagnose client issues after the fact.
 */
export function logMissingFormIntent({
  formData,
  request,
  bookingId,
  userId,
}: {
  formData: FormData;
  request: Request;
  bookingId: string;
  userId: string;
}) {
  const intent = formData.get("intent");
  if (typeof intent === "string" && intent.length > 0) {
    return;
  }

  const safeHeaders = Object.fromEntries(
    Array.from(request.headers.entries()).filter(
      ([key]) => !["cookie", "authorization"].includes(key.toLowerCase())
    )
  );

  const formSnapshot: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    const isFile = typeof File !== "undefined" && value instanceof File;
    const serialisedValue = isFile
      ? {
          kind: "file" as const,
          name: value.name,
          size: value.size,
          type: value.type,
        }
      : value;

    if (formSnapshot[key] === undefined) {
      formSnapshot[key] = serialisedValue;
    } else if (Array.isArray(formSnapshot[key])) {
      (formSnapshot[key] as unknown[]).push(serialisedValue);
    } else {
      formSnapshot[key] = [formSnapshot[key], serialisedValue];
    }
  }

  Logger.error({
    name: "BookingIntentMissing",
    message:
      "Form submitted without an intent field. Capturing request snapshot for investigation.",
    shouldBeCaptured: true,
    additionalData: {
      bookingId,
      userId,
      requestUrl: request.url,
      method: request.method,
      headers: safeHeaders,
      formKeys: Array.from(new Set(Array.from(formData.keys()))),
      formSnapshot,
    },
  });
}
