import { isRouteErrorResponse } from "@remix-run/react";
import type { ZodType } from "zod";
import type { DataOrErrorResponse, ErrorResponse, ValidationError } from ".";

export function isErrorResponse(response: unknown): response is ErrorResponse {
  return (
    typeof response === "object" &&
    response !== null &&
    "error" in response &&
    response.error !== null
  );
}

export function isRouteError(
  response: unknown
): response is { data: ErrorResponse } {
  return isRouteErrorResponse(response) && isErrorResponse(response.data);
}

function hasValidationErrors<Schema extends ZodType<any, any, any>>(
  additionalData: unknown
): additionalData is {
  validationErrors: ValidationError<Schema>;
} {
  return (
    typeof additionalData === "object" &&
    additionalData !== null &&
    "validationErrors" in additionalData &&
    typeof additionalData.validationErrors === "object" &&
    additionalData.validationErrors !== null
  );
}

/**
 * Get the validation errors returned by loader/action error.
 *
 */
export function getValidationErrors<Schema extends ZodType<any, any, any>>(
  error: DataOrErrorResponse["error"] | null | undefined
) {
  if (!error || !hasValidationErrors<Schema>(error.additionalData)) {
    return undefined;
  }

  return error.additionalData.validationErrors;
}
