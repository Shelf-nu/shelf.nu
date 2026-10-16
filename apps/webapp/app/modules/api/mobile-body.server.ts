/**
 * Mobile API request-body validation.
 *
 * The `api+/mobile+/*` actions validate their JSON body with a Zod schema and
 * then let the route's outer `catch` turn anything thrown into a response. A
 * bare `schema.parse()` throws a `ZodError`, which `makeShelfError` does not
 * recognise — it falls through to the generic branch and becomes a **500** with
 * the message "Sorry, something went wrong.", captured to Sentry. That is the
 * wrong answer for a malformed client payload twice over: the caller gets a
 * server-error status for their own bad input, and the noise reaches Sentry.
 *
 * This helper converts the `ZodError` into the same shape the routes already use
 * for their `BookingFormSchema` validation — a 400 carrying the first
 * user-facing message, with `shouldBeCaptured: false`.
 *
 * @see {@link file://../../utils/error.ts} makeShelfError — the generic branch this avoids
 * @see {@link file://../../utils/http.server.ts} parseData — the FormData equivalent for web routes
 */
import { z } from "zod";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError } from "~/utils/error";

/**
 * Read and validate a mobile JSON body, surfacing client-input failures as a
 * 400 rather than an uncaptured 500.
 *
 * Takes the `Request` rather than an already-parsed body on purpose: a body that
 * is not valid JSON makes `request.json()` throw a `SyntaxError`, which reaches
 * the same generic 500 + Sentry branch this helper exists to avoid. Parsing here
 * keeps both failure modes — unparseable JSON and schema-invalid JSON — on the
 * 400 path.
 *
 * @param schema - The Zod schema describing the expected body.
 * @param request - The incoming request whose JSON body to read.
 * @param label - `ShelfError` label for the thrown error. Defaults to "Booking"
 *   since the booking actions are the current callers; pass the owning domain
 *   when reusing this from another mobile route.
 * @returns The validated, typed body.
 * @throws {ShelfError} 400 (not captured) for unparseable JSON or schema
 *   violations; rethrows anything else untouched.
 */
export async function parseMobileBody<Schema extends z.ZodTypeAny>(
  schema: Schema,
  request: Request,
  label: ErrorLabel = "Booking"
): Promise<z.infer<Schema>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Request body must be valid JSON.",
      label,
      status: 400,
      shouldBeCaptured: false,
    });
  }

  try {
    return schema.parse(body);
  } catch (cause) {
    if (cause instanceof z.ZodError) {
      throw new ShelfError({
        cause,
        // Name the offending field so "Time zone must be a valid IANA zone"
        // reaches the client instead of a generic failure.
        message: cause.errors[0]?.message ?? "Invalid request body.",
        label,
        status: 400,
        shouldBeCaptured: false,
      });
    }
    throw cause;
  }
}
