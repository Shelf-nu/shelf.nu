import { data, type Params } from "react-router";
import { parseFormAny } from "react-zorm";
import type { ZodType } from "zod";
import { sendNotification } from "./emitter/send-notification.server";
import { SERVER_URL, URL_SHORTENER } from "./env";
import type { Options } from "./error";
import {
  ShelfError,
  makeShelfError,
  badRequest,
  notAllowedMethod,
} from "./error";
import type { ValidationError } from "./http";
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

/**
 * Get the pathname and search params from the Referer header.
 *
 * This is useful for redirecting users back to the page they came from
 * after completing an action (e.g., editing an entity), while preserving
 * their search/filter context.
 *
 * @param request - The request object
 * @returns The pathname + search from the referer header, or null if not available or invalid
 *
 * @example
 * // User navigates from /assets?search=laptop&status=AVAILABLE to /assets/123/edit
 * const refererPath = getRefererPath(request);
 * // returns "/assets?search=laptop&status=AVAILABLE"
 *
 * redirect(safeRedirect(refererPath, `/assets/${id}`));
 */
export function getRefererPath(request: Request): string | null {
  const referer = request.headers.get("referer");
  if (!referer) {
    return null;
  }

  try {
    const url = new URL(referer);
    return `${url.pathname}${url.search}`;
  } catch {
    // Invalid URL in referer header
    return null;
  }
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
 * Validate data with a zod schema.
 *
 * @throws A `badRequest` error if the form data is invalid.
 *
 * **By default, the error will be captured.**
 *
 * If you don't want to capture the error, you can set the `shouldBeCaptured` option to `false`.
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
    const validationErrors = {} as ValidationError<Schema>;

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
        shouldBeCaptured: true,
        ...options,
        additionalData: {
          ...options?.additionalData,
          data,
          validationErrors,
        },
      }
    );
  }

  return submission.data as Schema["_output"];
}

/**
 * Get and validate request params with a zod schema.
 *
 * **Use this function outside of loader/action try/catch blocks.**
 *
 * @throws A `json` response with a 400 status code if the params are invalid.
 *
 * **By default, the error will be captured.**
 *
 * If you don't want to capture the error, you can set the `shouldBeCaptured` option to `false`.
 *
 */
export function getParams<Schema extends ZodType<any, any, any>>(
  params: Params<string>,
  schema: Schema,
  options?: Options
) {
  try {
    return parseData(params, schema, {
      shouldBeCaptured: true,
      ...options,
      additionalData: {
        ...options?.additionalData,
      },
    });
  } catch (cause) {
    const reason = cause instanceof ShelfError ? cause : makeShelfError(cause);
    throw data(error(reason), { status: 400 });
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
  /** List of domains we allow to redirect to
   */
  const safeList = [SERVER_URL, `https://${URL_SHORTENER}`];

  if (!to || typeof to !== "string" || to.startsWith("//")) {
    return defaultRedirect;
  }

  // Block internal Remix routes (manifest, etc.) from being used as redirects
  // These are framework-internal URLs created by lazy route discovery
  if (to.startsWith("/__")) {
    return defaultRedirect;
  }

  // Check if the URL starts with any of the safe domains
  const isSafeDomain = safeList.some((safeUrl) => to.startsWith(safeUrl));
  if (!to.startsWith("/") && !isSafeDomain) {
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
export function payload<T extends ResponsePayload>(data: T) {
  return { error: null, ...data };
}

export type DataResponse<T extends ResponsePayload = ResponsePayload> =
  ReturnType<typeof payload<T>>;

/**
 * Create an error response payload.
 *
 * Normalize the error to return to help type inference.
 *
 * @param cause - The error that has been catch
 * @returns The normalized error with `error` key set to the error
 */
export function error(cause: ShelfError, shouldSendNotification = true) {
  if (cause.label !== "Request aborted") {
    Logger.error(cause);
  }

  if (
    cause.label !== "Request aborted" &&
    cause.additionalData?.userId &&
    typeof cause.additionalData?.userId === "string" &&
    shouldSendNotification
  ) {
    sendNotification({
      title: cause.title || "Oops! Something went wrong",
      message: cause.message,
      icon: { name: "x", variant: "error" },
      senderId: cause.additionalData.userId,
    });
  }

  return {
    error: {
      message: cause.message,
      label: cause.label,
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
