/**
 * SCIM error type and response serialisation
 *
 * SCIM defines its own error envelope (RFC 7644 §3.12) — IdPs parse it to
 * decide whether a failure is retryable, and Entra ID surfaces `detail`
 * verbatim in its provisioning logs. So SCIM routes must not fall back to
 * Shelf's normal `ShelfError` handling; they catch through
 * {@link handleScimError} instead.
 *
 * @see {@link file://./../../routes/api+/scim+/v2+/Users._index.ts}
 * @see https://www.rfc-editor.org/rfc/rfc7644#section-3.12
 */
import { Logger } from "~/utils/logger";
import { SCIM_CONTENT_TYPE, SCIM_SCHEMA_ERROR } from "./types";

/**
 * An error that maps directly onto a SCIM error response.
 *
 * Throw this (rather than `ShelfError`) anywhere under `modules/scim`, so the
 * status and `scimType` reach the IdP intact instead of collapsing into a 500.
 */
export class ScimError extends Error {
  /** HTTP status to respond with, e.g. 400, 401, 404, 409. */
  status: number;
  /**
   * SCIM error keyword (RFC 7644 §3.12) such as `uniqueness`, `invalidValue`,
   * `invalidFilter` or `invalidSyntax`. Omitted when no keyword applies.
   */
  scimType?: string;

  /**
   * @param detail - Human-readable description; surfaced in IdP logs
   * @param status - HTTP status for the response
   * @param scimType - Optional SCIM error keyword
   */
  constructor(detail: string, status: number, scimType?: string) {
    super(detail);
    this.name = "ScimError";
    this.status = status;
    this.scimType = scimType;
  }
}

/**
 * Serialises a {@link ScimError} into its SCIM error `Response`.
 *
 * `status` is emitted as a string inside the body as well as on the response —
 * the spec requires it, and some connectors read the body rather than the
 * HTTP status.
 *
 * @param err - The error to serialise
 * @returns A `Response` carrying the SCIM error envelope and `scim+json` type
 */
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
