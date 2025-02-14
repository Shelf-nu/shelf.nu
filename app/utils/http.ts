import { isRouteErrorResponse } from "@remix-run/react";
import type { ZodType } from "zod";
import { VALIDATION_ERROR } from "./error";
import type { DataOrErrorResponse, ErrorResponse } from "./http.server";

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

export type ValidationError<Schema extends ZodType<any, any, any>> = Record<
  keyof Schema["_output"],
  { message: string | undefined }
>;

function hasValidationErrors<Schema extends ZodType<any, any, any>>(
  additionalData: unknown
): additionalData is {
  validationErrors: Partial<ValidationError<Schema>>;
} {
  return (
    typeof additionalData === "object" &&
    additionalData !== null &&
    VALIDATION_ERROR in additionalData &&
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

  return error.additionalData[VALIDATION_ERROR];
}

/**
 * Get a redirect url from a request persisting the URLSearchParams
 */
export function getRedirectUrlFromRequest(request: Request) {
  const url = new URL(request.url);
  const searchParams = url.searchParams.toString();
  const redirectUrl = `${url.pathname}${
    searchParams ? `?${searchParams}` : ""
  }`;
  return redirectUrl;
}
