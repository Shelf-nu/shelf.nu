import type { HTTPStatusCode } from "./http-status";

/**
 * The goal of this custom error class is to normalize our errors.
 */

/**
 * @param message The message intended for the user.
 *
 * Other params are for logging purposes and help us debug.
 * @param cause The error that caused the rejection.
 * @param metadata Additional data to help us debug.
 * @param tag A tag to help us debug and filter logs.
 *
 */
export type FailureReason = {
  message: string;
  title?: string;
  status?: HTTPStatusCode;
  cause?: unknown;
  metadata?: Record<string, unknown>;
  tag?: string;
  traceId?: string;
};

/**
 * A custom error class to normalize the error handling in our app.
 */
export class ShelfStackError extends Error {
  readonly cause: FailureReason["cause"];
  readonly metadata: FailureReason["metadata"];
  readonly tag: FailureReason["tag"];
  readonly status: FailureReason["status"];
  readonly title: FailureReason["title"];
  traceId: FailureReason["traceId"];

  constructor({
    message,
    status = 500,
    cause = null,
    metadata,
    tag = "untagged 🐞",
    traceId,
    title,
  }: FailureReason) {
    super();
    this.name = "ShelfStackError 👀";
    this.message = message;
    this.status = isShelfStackError(cause) ? cause.status : status;
    this.cause = cause;
    this.metadata = metadata;
    this.tag = tag;
    this.traceId = traceId;
    this.title = title;
  }
}

export function isShelfStackError(cause: unknown): cause is ShelfStackError {
  return cause instanceof ShelfStackError;
}

export function handleUniqueConstraintError(cause: any, modelName: string) {
  if (cause?.code && cause.code === "P2002") {
    return {
      item: null,
      error: {
        message: `${modelName} name is already taken. Please choose a different name.`,
      },
    };
  } else {
    return {
      item: null,
      error: {
        message: "Something went wrong. Please try again later.",
      },
    };
  }
}
