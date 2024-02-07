import type { HTTPStatusCode } from "./http-status";

/**
 * The goal of this custom error class is to normalize our errors.
 */

/**
 * Additional data to help us debug.
 */
type SerializableValue = string | number | boolean | object | null | undefined;
export type AdditionalData = Record<string, SerializableValue>;

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
  additionalData?: AdditionalData;
  tag?: string;
  traceId?: string;
};

/**
 * A custom error class to normalize the error handling in our app.
 */
export class ShelfStackError extends Error {
  readonly cause: FailureReason["cause"];
  readonly additionalData: FailureReason["additionalData"];
  readonly tag: FailureReason["tag"];
  readonly status: FailureReason["status"];
  readonly title: FailureReason["title"];
  readonly isShelfError: boolean;
  traceId: FailureReason["traceId"];

  constructor({
    message,
    status = 500,
    cause = null,
    additionalData,
    tag = "untagged 🐞",
    traceId,
    title,
  }: FailureReason) {
    super();
    this.name = "ShelfStackError";
    this.message = message;
    this.status = isLikeShelfError(cause)
      ? cause.status || status || 500
      : status || 500;
    this.cause = cause;
    this.additionalData = additionalData;
    this.tag = tag;
    this.traceId = traceId;
    this.title = title;
    this.isShelfError = isLikeShelfError(cause);
  }
}

/**
 * This helper function is used to check if an error is an instance of `AppError` or an object that looks like an `AppError`.
 */
export function isLikeShelfError(cause: unknown): cause is ShelfStackError {
  return (
    cause instanceof ShelfStackError ||
    (typeof cause === "object" &&
      cause !== null &&
      "name" in cause &&
      cause.name !== "Error" &&
      "message" in cause)
  );
}

export function makeShelfError(
  cause: unknown,
  additionalData?: AdditionalData
) {
  if (isLikeShelfError(cause)) {
    // copy the original error and fill in the maybe missing fields like status or traceId
    return new ShelfStackError({
      ...cause,
      ...additionalData,
    });
  }

  // 🤷‍♂️ We don't know what this error is, so we create a new default one.
  return new ShelfStackError({
    cause,
    message: "Sorry, something went wrong.",
    additionalData,
  });
}

export function handleUniqueConstraintError(
  cause: any,
  modelName: string,
  additionalData?: AdditionalData
) {
  if (cause?.code && cause.code === "P2002") {
    return {
      item: null,
      error: {
        message: `${modelName} name is already taken. Please choose a different name.`,
      },
    };
  } else {
    throw new ShelfStackError({
      message: `Error creating ${modelName}: ${cause}`,
      cause,
      additionalData: {
        modelName,
        ...additionalData,
      },
    });
  }
}
