type ExtraParams = {
  [key: string]: string | number | boolean;
};

export function getCurrentPath(request: Request) {
  return new URL(request.url).pathname;
}

export function getCurrentSearchParams(request: Request) {
  return new URL(request.url).searchParams;
}

export function makeRedirectToFromHere(request: Request) {
  return new URLSearchParams([["redirectTo", getCurrentPath(request)]]);
}

export function mergeQueryParams(
  searchParams: URLSearchParams,
  extraParams: ExtraParams
) {
  // Merge the existing query parameters with the extra parameters
  const mergedParams = new URLSearchParams(searchParams);
  Object.entries(extraParams).forEach(([key, value]) =>
    mergedParams.set(key, value?.toString())
  );

  // Return the merged query parameters as a string
  return `?${mergedParams.toString()}`;
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

export function notFound(message: string) {
  return new Response(message, { status: 404 });
}

function notAllowedMethod(message: string) {
  return new Response(message, { status: 405 });
}

function badRequest(message: string) {
  return new Response(message, { status: 400 });
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

export function assertIsPost(request: Request, message = "Method not allowed") {
  if (!isPost(request)) {
    throw notAllowedMethod(message);
  }
}

export function assertIsDelete(
  request: Request,
  message = "Method not allowed"
) {
  if (!isDelete(request)) {
    throw notAllowedMethod(message);
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
