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
 * @param label A label to help us debug and filter logs.
 * @param cause The error that caused the rejection.
 * @param additionalData Additional data to help us debug.
 *
 */
export type FailureReason = {
  cause: unknown | null;
  label:
    | "Unknown"
    // Related to our modules
    | "Asset"
    | "Auth"
    | "Booking"
    | "CSV"
    | "Healthcheck"
    | "Image"
    | "Invite"
    | "Location"
    | "Organization"
    | "Permission"
    | "QR"
    | "Report"
    | "Settings"
    | "File storage"
    | "Stripe"
    | "Subscription"
    | "Tag"
    | "Team"
    | "Tier"
    | "User"
    // Other kinds of errors
    | "Request validation"
    | "DB constrain violation"
    | "Dev error" // Error that should never happen in production because it's a developer mistake
    | "Environment"; // Related to the environment setup
  message: string;
  title?: string;
  additionalData?: AdditionalData;
  traceId?: string;
  status?:
    | 200 // ok
    | 204 // no content
    | 400 // bad request
    | 401 // unauthorized
    | 403 // forbidden
    | 404 // not found
    | 405 // method not allowed
    | 409 // conflict
    | 500; // internal server error
  // Add more status codes as needed: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status
};

export type ErrorLabel = FailureReason["label"];

/**
 * A custom error class to normalize the error handling in our app.
 */
export class ShelfError extends Error {
  readonly cause: FailureReason["cause"];
  readonly label: FailureReason["label"];
  readonly title: FailureReason["title"];
  readonly additionalData: FailureReason["additionalData"];
  readonly status: FailureReason["status"];
  // FIXME: clean this after getting the reason for this line
  // readonly isShelfError: boolean;
  traceId: FailureReason["traceId"];

  constructor({
    cause = null,
    message,
    title,
    status,
    additionalData,
    label,
    traceId,
  }: FailureReason) {
    super();
    this.name = "ShelfError";
    this.cause = cause;
    this.message = message;
    this.title = isLikeShelfError(cause) ? title || cause.title : title;
    this.status = isLikeShelfError(cause)
      ? status || cause.status || 500
      : status || 500;
    this.additionalData = additionalData;
    this.label = label;
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
    label: "DB constrain violation",
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
    label: "Request validation",
  });
}

export function badRequest(message: string, additionalData?: AdditionalData) {
  return new ShelfError({
    cause: null,
    message,
    status: 400,
    additionalData,
    label: "Request validation",
  });
}
