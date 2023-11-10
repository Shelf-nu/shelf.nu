import { isRouteErrorResponse } from "@remix-run/react";
import type { ErrorResponse } from ".";

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
