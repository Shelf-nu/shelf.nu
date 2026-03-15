import { createId } from "@paralleldrive/cuid2";
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
    | "Barcode"
    | "Booking"
    | "Booking Settings"
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
    | "Working hours"
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
    | "User Contact"
    | "Scanner"
    | "SSO"
    | "Kit"
    | "Note"
    | "Audit Image"
    // Other kinds of errors
    | "DB"
    | "Request validation"
    | "Request aborted"
    | "DB constrain violation"
    | "Dev error" // Error that should never happen in production because it's a developer mistake
    | "Environment" // Related to the environment setup
    | "Image Import"
    | "Image Cache"
    | "Asset Reminder"
    | "Asset Scheduler" // Error related to the image import
    | "Audit"
    | "Update";
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
    | 499 // client closed request
    | 500 // internal server error
    | 503; // service unavailable
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

function isAbortError(cause: unknown) {
  if (!cause) {
    return false;
  }

  if (cause instanceof Error) {
    const name = cause.name?.toLowerCase?.() ?? "";
    const message = cause.message?.toLowerCase?.() ?? "";
    const code =
      "code" in cause && typeof (cause as any).code === "string"
        ? (cause as any).code
        : "";

    if (name === "aborterror") {
      return true;
    }

    if (
      message.includes("call aborted") ||
      message.includes("request aborted") ||
      message === "aborted" ||
      code === "ECONNRESET"
    ) {
      return true;
    }

    if (typeof cause.cause === "string") {
      return cause.cause.toLowerCase().includes("aborted");
    }

    if (cause.cause instanceof Error) {
      return isAbortError(cause.cause);
    }
  }

  if (typeof cause === "string") {
    return cause.toLowerCase().includes("aborted");
  }

  return false;
}

/**
 * Supabase/PostgREST error shape returned in `{ error }` responses.
 */
interface SupabaseError {
  code?: string;
  message?: string;
  details?: string;
}

/**
 * Checks if a Supabase error indicates "no rows found" (PostgREST 406 / PGRST116).
 * Replaces the former Prisma P2025 check.
 */
export function isNotFoundError(cause: unknown): cause is SupabaseError {
  if (typeof cause !== "object" || cause === null) return false;

  // PostgREST error code for "no rows returned"
  if ("code" in cause && cause.code === "PGRST116") return true;

  // Supabase JS sometimes surfaces the message instead of the code
  if ("message" in cause && typeof (cause as any).message === "string") {
    const msg = (cause as any).message.toLowerCase();
    if (
      msg.includes("no rows found") ||
      msg.includes("json object requested, multiple (or no) rows returned")
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Postgres/Supabase error codes that indicate transient/connection issues
 * rather than actual data problems.
 * Replaces former Prisma P2024/P1001/P1002/P1008/P1017 checks.
 */
export const TRANSIENT_ERROR_CODES = new Set([
  "08000", // connection_exception
  "08003", // connection_does_not_exist
  "08006", // connection_failure
  "53300", // too_many_connections
  "57014", // query_cancelled (timeout)
  "57P01", // admin_shutdown
  "40001", // serialization_failure (retry-safe)
]);

/**
 * Checks if an error is a transient database/connection error
 * that should NOT be reported as a domain-specific "not found" error.
 */
export function isTransientError(cause: unknown): boolean {
  if (typeof cause !== "object" || cause === null) return false;
  if ("code" in cause && typeof cause.code === "string") {
    return TRANSIENT_ERROR_CODES.has(cause.code);
  }
  if (cause instanceof Error) {
    const msg = cause.message.toLowerCase();
    return (
      msg.includes("connection") ||
      msg.includes("too many connections") ||
      msg.includes("timed out") ||
      msg.includes("fetch failed")
    );
  }
  return false;
}

/**
 * Walks the cause chain of an error to detect if a transient
 * database error is buried inside ShelfError wrappers.
 */
function hasTransientCause(error: unknown): boolean {
  if (isTransientError(error)) return true;
  if (typeof error === "object" && error !== null && "cause" in error) {
    return hasTransientCause((error as { cause: unknown }).cause);
  }
  return false;
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
  if (isAbortError(cause)) {
    return new ShelfError({
      cause,
      label: "Request aborted",
      message: "The request was cancelled before it could complete.",
      shouldBeCaptured: false,
      status: 499,
    });
  }

  // Detect transient DB errors buried in ShelfError wrappers.
  // This prevents misleading messages like "User not found" when the
  // real issue is a connection pool timeout.
  if (hasTransientCause(cause)) {
    return new ShelfError({
      cause,
      message:
        "We're experiencing temporary database connectivity issues. Please try again in a moment.",
      label: "DB",
      additionalData,
      shouldBeCaptured: true,
      status: 503,
    });
  }

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

  // We don't know what this error is, so we create a new default one.
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
 * Error for when you could suspect a unique constraint violation.
 * Detects Postgres error code 23505 (unique_violation).
 *
 * **By default, the error will not be captured if it is a constraint violation**
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

  if (isUniqueConstraintViolation(cause)) {
    shouldBeCaptured = false;

    // Extract the constraint/detail from the Postgres error
    const detail =
      typeof cause === "object" && cause !== null && "details" in cause
        ? String((cause as any).details)
        : "";

    // Try to extract the field name from the detail string
    // Postgres detail looks like: Key (name, "organizationId")=(foo, bar) already exists.
    const fieldMatch = detail.match(/Key \(([^)]+)\)/);
    const fields = fieldMatch
      ? fieldMatch[1].split(",").map((f) => f.trim().replace(/"/g, ""))
      : [];

    // Filter out organizational fields
    const relevantFields = fields.filter(
      (field) =>
        field !== "organizationId" &&
        field !== "userId" &&
        field !== "teamId" &&
        field !== "organization_id"
    );

    const failedField = relevantFields[0] || "name";

    message = `${modelName} ${failedField} is already taken. Please choose a different ${failedField}.`;
    validationErrors[failedField] = { message };
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

/**
 * Checks if a Supabase/Postgres error is a unique constraint violation (23505).
 */
export function isUniqueConstraintError(cause: unknown): boolean {
  if (typeof cause !== "object" || cause === null) return false;
  if ("code" in cause && cause.code === "23505") return true;
  if ("message" in cause && typeof (cause as any).message === "string") {
    return (cause as any).message.toLowerCase().includes("unique constraint");
  }
  return false;
}

/** Keep internal alias for backward compat within this file */
const isUniqueConstraintViolation = isUniqueConstraintError;

/**
 * Checks if a unique constraint error involves a specific column.
 * Supabase/Postgres errors include a `details` field like:
 *   Key (value, "organizationId")=(foo, bar) already exists.
 */
export function constraintInvolves(cause: unknown, field: string): boolean {
  if (typeof cause !== "object" || cause === null) return false;
  const details = "details" in cause ? String((cause as any).details) : "";
  const message = "message" in cause ? String((cause as any).message) : "";
  return details.includes(field) || message.includes(field);
}
