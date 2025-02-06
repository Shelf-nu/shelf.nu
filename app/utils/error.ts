import { createId } from "@paralleldrive/cuid2";
import { Prisma } from "@prisma/client";
import type { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import type { ValidationError } from "./http";

/**
 * The goal of this custom error class is to normalize our errors.
 */

type SerializableValue = string | number | boolean | object | null | undefined;

export const VALIDATION_ERROR = "validationErrors";

/**
 * Additional data to help us debug.
 */
export type AdditionalData =
  | {
      [key: string]: SerializableValue;
    }
  | {
      [VALIDATION_ERROR]?: ValidationError<any> | undefined;
      [key: string]: SerializableValue;
    };

/**
 * @param message The message intended for the user.
 * @param title The title of the error, if any, for a modal, a toast, etc.
 *
 * Other params are for logging purposes and help us debug.
 * @param label A label to help us debug and filter logs.
 * @param cause The error that caused the rejection.
 * @param additionalData Additional data to help us debug.
 * @param shouldBeCaptured Whether we should capture this error or not.
 *
 */
export type FailureReason = {
  /**
   * The error that caused the rejection, if any.
   */
  cause: unknown | null;
  /**
   * A label to help us debug and filter logs.
   */
  label:
    | "Unknown"
    // Related to our modules
    | "Admin dashboard"
    | "App layout"
    | "Assets"
    | "Asset Index Settings"
    | "Auth"
    | "Booking"
    | "Category"
    | "Crop image"
    | "CSV"
    | "Custody"
    | "Custom fields"
    | "Dashboard"
    | "Email"
    | "Healthcheck"
    | "Image"
    | "Invite"
    | "User onboarding"
    | "Location"
    | "Notification"
    | "Organization"
    | "Permission"
    | "QR"
    | "Report"
    | "Settings"
    | "File storage"
    | "Scan"
    | "Scheduler"
    | "Stripe"
    | "Stripe webhook"
    | "Subscription"
    | "Tag"
    | "Team"
    | "Team Member"
    | "Tier"
    | "User"
    | "Scanner"
    | "SSO"
    | "Kit"
    | "Note"
    // Other kinds of errors
    | "DB"
    | "Request validation"
    | "DB constrain violation"
    | "Dev error" // Error that should never happen in production because it's a developer mistake
    | "Environment" // Related to the environment setup
    | "Image Import"
    | "Image Cache"
    | "Asset Reminder"
    | "Asset Scheduler"; // Error related to the image import
  /**
   * The message intended for the user.
   * You can add new lines using \n which will be parsed into paragraphs in the html
   * Moveoer, you can add html to highlight strings
   */
  message: string;
  /**
   * The title of the error, if any, for a modal, a toast, etc.
   */
  title?: string;
  /**
   * Additional data to help us debug.
   *
   * **Do not put sensitive data here.** It will be logged and could be sent to Sentry.
   */
  additionalData?: AdditionalData;
  /**
   * Whether we should capture this error or not.
   *
   * If not, it will be logged but not sent to Sentry.
   *
   * **Default is true**
   */
  shouldBeCaptured?: boolean;
  /**
   * The traceId is a unique identifier for the error.
   *
   * It can be the Stripe event id or an random generated id.
   */
  traceId?: string;
  /**
   * The HTTP status code to return.
   *
   * Add more status codes as needed: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status
   */
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
  readonly shouldBeCaptured: FailureReason["shouldBeCaptured"];
  readonly status: FailureReason["status"];

  traceId: FailureReason["traceId"];

  constructor({
    cause,
    label,
    message,
    title,
    additionalData,
    shouldBeCaptured,
    status,
    traceId,
  }: FailureReason) {
    super();
    this.name = "ShelfError";
    this.cause = cause;
    this.label = label;
    this.message = message;
    this.title = isLikeShelfError(cause) ? title || cause.title : title;
    this.additionalData = additionalData;
    this.shouldBeCaptured =
      (isLikeShelfError(cause)
        ? shouldBeCaptured ?? cause.shouldBeCaptured
        : shouldBeCaptured) ?? true;
    this.status = isLikeShelfError(cause)
      ? status || cause.status || 500
      : isNotFoundError(cause)
      ? 404
      : status || 500;
    this.traceId = traceId || createId();
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

/**
 * This helper function is used to check if an error is an instance of `ShelfError` or an object that looks like an `ShelfError`.
 */
export function isNotFoundError(
  cause: unknown
): cause is PrismaClientKnownRequestError {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    cause.code === "P2025"
  );
}

/**
 * This function is used to check if the error is a zod validation error.
 */
export function isZodValidationError(cause: unknown) {
  if (!isLikeShelfError(cause)) {
    return false;
  }

  return cause.additionalData && "validationErrors" in cause.additionalData;
}

export function makeShelfError(
  cause: unknown,
  additionalData?: AdditionalData,
  shouldBeCaptured: boolean = true
) {
  if (isLikeShelfError(cause)) {
    // copy the original error and fill in the maybe missing fields like status or traceId
    return new ShelfError({
      ...cause,
      additionalData: {
        ...cause.additionalData,
        ...additionalData,
      },
      shouldBeCaptured:
        "shouldBeCaptured" in cause ? cause.shouldBeCaptured : shouldBeCaptured,
    });
  }

  // 🤷‍♂️ We don't know what this error is, so we create a new default one.
  return new ShelfError({
    cause,
    message: "Sorry, something went wrong.",
    additionalData,
    label: "Unknown",
    shouldBeCaptured,
  });
}

/* --------------------------------------------------------------------------- */
/*                               Pre made errors                               */
/* --------------------------------------------------------------------------- */

export type Options = Partial<
  Pick<
    FailureReason,
    "additionalData" | "message" | "title" | "shouldBeCaptured"
  >
>;

/**
 * Error for when a method is not allowed.
 *
 * **By default, the error will not be captured.**
 *
 * If you want to capture the error, you can set the `shouldBeCaptured` option to `true`.
 */
export function notAllowedMethod(method: string, options?: Options) {
  return new ShelfError({
    shouldBeCaptured: false,
    message: `"${method}" method is not allowed.`,
    ...options,
    cause: null,
    status: 405,
    label: "Request validation",
  });
}

/**
 * Error for when a resource is not found.
 *
 * **By default, the error will not be captured.**
 *
 * If you want to capture the error, you can set the `shouldBeCaptured` option to `true`.
 */
export function badRequest(
  message: string,
  options?: Omit<Options, "message">
) {
  return new ShelfError({
    shouldBeCaptured: false,
    ...options,
    cause: null,
    message,
    status: 400,
    label: "Request validation",
  });
}

/**
 * Error for when a you could suspect a unique constraint violation.
 *
 * **By default, the error will not be captured if it is a constrain violation**
 *
 * If you want to capture all errors, you can set the `shouldBeCaptured` option to `true`.
 */
export function maybeUniqueConstraintViolation(
  cause: unknown,
  modelName: string,
  options?: Options
) {
  let message = `We could not create or update this ${modelName}. Please try again or contact support.`;
  let shouldBeCaptured = false;
  const validationErrors = {} as ValidationError<any>;

  if (
    cause instanceof Prisma.PrismaClientKnownRequestError &&
    cause.code === "P2002"
  ) {
    message = `${modelName} name is already taken. Please choose a different name.`;
    shouldBeCaptured = false;
    validationErrors["name"] = {
      message,
    };
  }

  return new ShelfError({
    cause,
    shouldBeCaptured,
    ...options,
    message,
    additionalData: {
      modelName,
      ...(options && options.additionalData),
      validationErrors,
    },
    label: "DB constrain violation",
  });
}
