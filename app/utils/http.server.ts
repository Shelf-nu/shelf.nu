import type { ShelfError } from "./error";
import { badRequest, notAllowedMethod } from "./error";
import { Logger } from "./logger";

export function getCurrentPath(request: Request) {
  return new URL(request.url).pathname;
}

export function getCurrentSearchParams(request: Request) {
  return new URL(request.url).searchParams;
}

export function makeRedirectToFromHere(request: Request) {
  return new URLSearchParams([["redirectTo", getCurrentPath(request)]]);
}

export function getRedirectTo(request: Request, defaultRedirectTo = "/") {
  const url = new URL(request.url);
  return safeRedirect(url.searchParams.get("redirectTo"), defaultRedirectTo);
}

export function isGet(request: Request) {
  return request.method.toLowerCase() === "get";
}

export function isPost(request: Request) {
  return request.method.toLowerCase() === "post";
}

export function isDelete(request: Request) {
  return request.method.toLowerCase() === "delete";
}

export function getRequiredParam(
  params: Record<string, string | undefined>,
  key: string
) {
  const value = params[key];

  if (!value) {
    throw badRequest(`Missing required request param "${key}"`);
  }

  return value;
}

export function assertIsPost(request: Request, message?: string) {
  if (!isPost(request)) {
    throw notAllowedMethod("POST", message);
  }
}

export function assertIsDelete(request: Request, message?: string) {
  if (!isDelete(request)) {
    throw notAllowedMethod("DELETE", message);
  }
}

/**
 * This should be used any time the redirect path is user-provided
 * (Like the query string on our login/signup pages). This avoids
 * open-redirect vulnerabilities.
 * @param {string} to The redirect destination
 * @param {string} defaultRedirect The redirect to use if the to is unsafe.
 */
export function safeRedirect(
  to: FormDataEntryValue | string | null | undefined,
  defaultRedirect = "/"
) {
  if (
    !to ||
    typeof to !== "string" ||
    !to.startsWith("/") ||
    to.startsWith("//")
  ) {
    return defaultRedirect;
  }

  return to;
}

export type ResponsePayload = Record<string, unknown> | null;

/**
 * Create a data response payload.
 *
 * Normalize the data to return to help type inference.
 *
 * @param data - The data to return
 * @returns The normalized data with `error` key set to `null`
 */
export function data<T extends ResponsePayload>(data: T) {
  return { error: null, ...data };
}

export type DataResponse<T extends ResponsePayload = ResponsePayload> =
  ReturnType<typeof data<T>>;

/**
 * Create an error response payload.
 *
 * Normalize the error to return to help type inference.
 *
 * @param cause - The error that has been catch
 * @returns The normalized error with `error` key set to the error
 */
export function error(cause: ShelfError) {
  Logger.error(cause);

  return {
    error: {
      message: cause.message,
      label: cause.label,
      // FIXME: clean this after getting the reason for this line
      // isShelfError: cause.isShelfError,
      ...(cause.additionalData && {
        additionalData: cause.additionalData,
      }),
      ...(cause.traceId && { traceId: cause.traceId }),
    },
  };
}

export type ErrorResponse = ReturnType<typeof error>;

export type DataOrErrorResponse<T extends ResponsePayload = ResponsePayload> =
  | ErrorResponse
  | DataResponse<T>;
