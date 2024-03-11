import { createId } from "@paralleldrive/cuid2";

/**
 * The goal of this custom error class is to normalize our errors.
 */

type SerializableValue = string | number | boolean | object | null | undefined;

/**
 * Additional data to help us debug.
 */
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
  label:
    | "Unknown"
    | "Unique constrain violation"
    | "Missing env"
    | "Bad request"
    | "Not allowed HTTP method";
  message: string;
  cause: unknown | null;
  additionalData?: AdditionalData;
  traceId?: string;
  status?:
    | 200 // ok
    | 204 // no content
    | 400 // bad request
    | 401 // unauthorized
    | 403 // forbidden
    | 404 // not found
    | 404 // not found
    | 405 // method not allowed
    | 409 // conflict
    | 500; // internal server error
  // Add more status codes as needed: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status
};

/**
 * A custom error class to normalize the error handling in our app.
 */
export class ShelfError extends Error {
  readonly label: FailureReason["label"];
  readonly cause: FailureReason["cause"];
  readonly additionalData: FailureReason["additionalData"];
  readonly status: FailureReason["status"];
  // FIXME: clean this after getting the reason for this line
  // readonly isShelfError: boolean;
  traceId: FailureReason["traceId"];

  constructor({
    message,
    status,
    cause = null,
    additionalData,
    label,
    traceId,
  }: FailureReason) {
    super();
    this.name = "ShelfError";
    this.label = label;
    this.message = message;
    this.status = isLikeShelfError(cause)
      ? status || cause.status || 500
      : status || 500;
    this.cause = cause;
    this.additionalData = additionalData;
    this.traceId = traceId || createId();
    // FIXME: clean this after getting the reason for this line
    // this.isShelfError =
    //   cause instanceof Error && cause.name === "ShelfStackError";
  }
}

/**
 * This helper function is used to check if an error is an instance of `ShelfError` or an object that looks like an `ShelfError`.
 */
export function isLikeShelfError(cause: unknown): cause is ShelfError {
  return (
    cause instanceof ShelfError ||
    (typeof cause === "object" &&
      cause !== null &&
      "label" in cause &&
      "message" in cause)
  );
}

export function makeShelfError(
  cause: unknown,
  additionalData?: AdditionalData
) {
  if (isLikeShelfError(cause)) {
    // copy the original error and fill in the maybe missing fields like status or traceId
    return new ShelfError({
      ...cause,
      additionalData: {
        ...cause.additionalData,
        ...additionalData,
      },
    });
  }

  // 🤷‍♂️ We don't know what this error is, so we create a new default one.
  return new ShelfError({
    cause,
    message: "Sorry, something went wrong.",
    additionalData,
    label: "Unknown",
  });
}

// FIXME: check this again to understand if it's still needed
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
  }

  throw new ShelfError({
    message: `Error creating ${modelName}: ${cause}`,
    cause,
    additionalData: {
      modelName,
      ...additionalData,
    },
    label: "Unique constrain violation",
  });
}

/* --------------------------------------------------------------------------- */
/*                               Pre made errors                               */
/* --------------------------------------------------------------------------- */

export function notAllowedMethod(
  method: "POST" | "DELETE",
  message = `"${method}" method is not allowed.`
) {
  return new ShelfError({
    cause: null,
    message,
    status: 405,
    label: "Not allowed HTTP method",
  });
}

export function badRequest(message: string) {
  return new ShelfError({
    cause: null,
    message,
    status: 400,
    label: "Bad request",
  });
}
