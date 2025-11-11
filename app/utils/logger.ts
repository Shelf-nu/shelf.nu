import * as Sentry from "@sentry/react-router";
import pino from "pino";

import { SENTRY_DSN, env } from "./env";
import { ShelfError } from "./error";

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
