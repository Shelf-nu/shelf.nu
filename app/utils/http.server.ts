import type { Params } from "@remix-run/react";
import { json } from "react-router";
import { parseFormAny } from "react-zorm";
import type { ZodType } from "zod";
import type { Options } from "./error";
import {
  ShelfError,
  makeShelfError,
  badRequest,
  notAllowedMethod,
} from "./error";
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

type HTTPMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export function getActionMethod(request: Request) {
  return request.method.toUpperCase() as Exclude<HTTPMethod, "GET">;
}

/**
 * FIXME: remove
 * @deprecated
 */
export function getRequiredParam(
  params: Record<string, string | undefined>,
  key: string
) {
  const value = params[key];

  if (!value) {
    throw badRequest(`Missing required request param "${key}"`, {
      additionalData: {
        params,
        key,
      },
    });
  }

  return value;
}

type ValidationError<Schema extends ZodType<any, any, any>> = Record<
  keyof Schema["_output"],
  { message: string | undefined }
>;

/**
 * Validate data with a zod schema.
 *
 * @throws A `badRequest` error if the form data is invalid.
 *
 * **By default, the error will not be captured.**
 *
 * If you want to capture the error, you can set the `shouldBeCaptured` option to `true`.
 */
export function parseData<Schema extends ZodType<any, any, any>>(
  data: FormData | URLSearchParams | Params,
  schema: Schema,
  options?: Options
) {
  if (data instanceof FormData) {
    data = parseFormAny(data);
  }

  if (data instanceof URLSearchParams) {
    data = Object.fromEntries(data);
  }

  const submission = schema.safeParse(data);

  if (!submission.success) {
    let validationErrors = {} as ValidationError<Schema>;

    Object.entries(submission.error.formErrors.fieldErrors).forEach(
      ([key, values]) => {
        validationErrors[key as keyof Schema["_output"]] = {
          message: values?.[0],
        };
      }
    );

    throw badRequest(
      options?.message ||
        "The request is invalid. Please try again. If the issue persists, contact support.",
      {
        ...options,
        additionalData: {
          ...options?.additionalData,
          validationErrors,
        },
      }
    );
  }

  return submission.data as Schema["_output"];
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

/**
 * Assert request params with a zod schema.
 *
 * **Use this function outside of loader/action try/catch blocks.**
 *
 * @throws A `json` response with a 400 status code if the params are invalid.
 *
 * **By default, the error will not be captured.**
 *
 * If you want to capture the error, you can set the `shouldBeCaptured` option to `true`.
 */
export function assertParams<Schema extends ZodType<any, any, any>>(
  params: Params<string>,
  schema: Schema,
  options?: Options
) {
  try {
    return parseData(params, schema, {
      ...options,
      additionalData: {
        ...options?.additionalData,
        params,
      },
    });
  } catch (cause) {
    let reason = cause instanceof ShelfError ? cause : makeShelfError(cause);
    throw json(error(reason), { status: 400 });
  }
}

export function assertIsPost(request: Request, message?: string) {
  if (!isPost(request)) {
    throw notAllowedMethod("POST", { message });
  }
}

export function assertIsDelete(request: Request, message?: string) {
  if (!isDelete(request)) {
    throw notAllowedMethod("DELETE", { message });
  }
}

/**
 * This should be used any time the redirect path is user-provided
 * (Like the query string on our login/signup pages). This avoids
 * open-redirect vulnerabilities.
 * @param to The redirect destination
 * @param defaultRedirect The redirect to use if the to is unsafe.
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
      ...(cause.title && { title: cause.title }),
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
