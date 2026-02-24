import { Logger } from "~/utils/logger";
import { SCIM_CONTENT_TYPE, SCIM_SCHEMA_ERROR } from "./types";

export class ScimError extends Error {
  status: number;
  scimType?: string;

  constructor(detail: string, status: number, scimType?: string) {
    super(detail);
    this.name = "ScimError";
    this.status = status;
    this.scimType = scimType;
  }
}

export function scimErrorResponse(err: ScimError): Response {
  return new Response(
    JSON.stringify({
      schemas: [SCIM_SCHEMA_ERROR],
      detail: err.message,
      status: String(err.status),
      ...(err.scimType && { scimType: err.scimType }),
    }),
    {
      status: err.status,
      headers: { "Content-Type": SCIM_CONTENT_TYPE },
    }
  );
}

/**
 * Wraps any thrown error into a SCIM-formatted error Response.
 * ScimErrors pass through with their status code; all others become 500s.
 */
export function handleScimError(err: unknown): Response {
  if (err instanceof ScimError) {
    return scimErrorResponse(err);
  }

  // Log unexpected errors but don't leak internal details
  Logger.error(err);

  return scimErrorResponse(new ScimError("Internal server error", 500));
}
